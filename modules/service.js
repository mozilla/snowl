/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Snowl.
 *
 * The Initial Developer of the Original Code is Mozilla.
 * Portions created by the Initial Developer are Copyright (C) 2008
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Myk Melez <myk@mozilla.org>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

const EXPORTED_SYMBOLS = ["SnowlService"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/feed.js");
Cu.import("resource://snowl/modules/twitter.js");
Cu.import("resource://snowl/modules/source.js");
Cu.import("resource://snowl/modules/URI.js");
Cu.import("resource://snowl/modules/utils.js");

const PERMS_FILE      = 0644;
const PERMS_DIRECTORY = 0755;

const TYPE_MAYBE_FEED = "application/vnd.mozilla.maybe.feed";
const PREF_CONTENTHANDLERS_BRANCH = "browser.contentHandlers.types.";
const SNOWL_HANDLER_URI = "chrome://snowl/content/subscribe.xul?feed=%s";
const SNOWL_HANDLER_TITLE = "Snowl";

// How often to check if sources need refreshing, in milliseconds.
const REFRESH_CHECK_INTERVAL = 60 * 1000; // 60 seconds

let SnowlService = {
  // Preferences Service
  get _prefSvc() {
    let prefSvc = Cc["@mozilla.org/preferences-service;1"].
                  getService(Ci.nsIPrefService).
                  QueryInterface(Ci.nsIPrefBranch).
                  QueryInterface(Ci.nsIPrefBranch2);
    this.__defineGetter__("_prefSvc", function() { return prefSvc });
    return this._prefSvc;
  },

  // Observer Service
  get _obsSvc() {
    let obsSvc = Cc["@mozilla.org/observer-service;1"].
                 getService(Ci.nsIObserverService);
    delete this._obsSvc;
    this._obsSvc = obsSvc;
    return this._obsSvc;
  },

  get _dirSvc() {
    let dirSvc = Cc["@mozilla.org/file/directory_service;1"].
                 getService(Ci.nsIProperties);
    this.__defineGetter__("_dirSvc", function() { return dirSvc });
    return this._dirSvc;
  },

  get _converterSvc() {
    let converterSvc =
      Cc["@mozilla.org/embeddor.implemented/web-content-handler-registrar;1"].
      getService(Ci.nsIWebContentConverterService);
    this.__defineGetter__("_converterSvc", function() { return converterSvc });
    return this._converterSvc;
  },

  _log: null,

  _init: function() {
    this._initLogs();
    this._registerFeedHandler();
    this._initTimer();

    // FIXME: refresh stale sources on startup in a way that doesn't hang
    // the UI thread.
    //this.refreshStaleSources();
  },

  _timer: null,
  _initTimer: function() {
    this._timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    let callback = {
      _svc: this,
      notify: function(aTimer) { this._svc.refreshStaleSources() }
    };
    this._timer.initWithCallback(callback,
                                 REFRESH_CHECK_INTERVAL,
                                 Ci.nsITimer.TYPE_REPEATING_SLACK);
  },

  _initLogs: function() {
    let formatter = Log4Moz.Service.newFormatter("basic");
    let root = Log4Moz.Service.rootLogger;
    root.level = Log4Moz.Level.Debug;

    let capp = Log4Moz.Service.newAppender("console", formatter);
    capp.level = Log4Moz.Level.Warn;
    root.addAppender(capp);

    let dapp = Log4Moz.Service.newAppender("dump", formatter);
    dapp.level = Log4Moz.Level.All;
    root.addAppender(dapp);

    let logFile = this._dirSvc.get("ProfD", Ci.nsIFile);

    let brief = this._dirSvc.get("ProfD", Ci.nsIFile);
    brief.QueryInterface(Ci.nsILocalFile);

    brief.append("snowl");
    if (!brief.exists())
      brief.create(brief.DIRECTORY_TYPE, PERMS_DIRECTORY);

    brief.append("logs");
    if (!brief.exists())
      brief.create(brief.DIRECTORY_TYPE, PERMS_DIRECTORY);

    brief.append("brief-log.txt");
    if (!brief.exists())
      brief.create(brief.NORMAL_FILE_TYPE, PERMS_FILE);

    let verbose = brief.parent.clone();
    verbose.append("verbose-log.txt");
    if (!verbose.exists())
      verbose.create(verbose.NORMAL_FILE_TYPE, PERMS_FILE);

    let fapp = Log4Moz.Service.newFileAppender("rotating", brief, formatter);
    fapp.level = Log4Moz.Level.Info;
    root.addAppender(fapp);
    let vapp = Log4Moz.Service.newFileAppender("rotating", verbose, formatter);
    vapp.level = Log4Moz.Level.Debug;
    root.addAppender(vapp);

    this._log = Log4Moz.Service.getLogger("Snowl.Service");
    this._log.info("initialized logging");
  },

  _registerFeedHandler: function() {
    if (this._converterSvc.getWebContentHandlerByURI(TYPE_MAYBE_FEED, SNOWL_HANDLER_URI))
      return;

    try {
      this._converterSvc.registerContentHandler(TYPE_MAYBE_FEED,
                                                SNOWL_HANDLER_URI,
                                                SNOWL_HANDLER_TITLE,
                                                null);
    }
    catch(ex) {
      // Bug 415732 hasn't been fixed yet, so work around the bug by writing
      // preferences directly, although the handler won't be available until
      // the user restarts the browser.
      // Based on code in browser/components/feeds/src/WebContentConverter.js.
      let i = 0;
      let typeBranch = null;
      while (true) {
        typeBranch = this._prefSvc.getBranch(PREF_CONTENTHANDLERS_BRANCH + i + ".");
        try {
          let type = typeBranch.getCharPref("type");
          let uri = typeBranch.getCharPref("uri");
          if (type == TYPE_MAYBE_FEED && uri == SNOWL_HANDLER_URI)
            return;
          ++i;
        }
        catch (e) {
          // No more handlers
          break;
        }
      }
      if (typeBranch) {
        typeBranch.setCharPref("type", TYPE_MAYBE_FEED);
        typeBranch.setCharPref("uri", SNOWL_HANDLER_URI);
        typeBranch.setCharPref("title", SNOWL_HANDLER_TITLE);
        this._prefSvc.savePrefFile(null);
      }
    }
  },

  get _getSourcesStatement() {
    let statement = SnowlDatastore.createStatement(
      "SELECT id, type, name, machineURI, humanURI, lastRefreshed, importance FROM sources"
    );
    delete this._getSourcesStatement;
    this._getSourcesStatement = statement;
    return this._getSourcesStatement;
  },

  getSources: function() {
    let sources = [];

    try {
      while (this._getSourcesStatement.step()) {
        let row = this._getSourcesStatement.row;

        let constructor = eval(row.type);
        if (!constructor) {
          this._log.warn("constructor " + row.type + " not defined; using SnowlSource");
          constructor = SnowlSource;
        }

        sources.push(new constructor(row.id,
                                     row.name,
                                     URI.get(row.machineURI),
                                     URI.get(row.humanURI),
                                     SnowlUtils.julianToJSDate(row.lastRefreshed),
                                     row.importance));
      }
    }
    finally {
      this._getSourcesStatement.reset();
    }

    return sources;
  },

  refreshStaleSources: function() {
    this._log.info("refreshing stale sources");

    // XXX Should SnowlDatastore::selectSources return SnowlSource objects,
    // of which SnowlFeed is a subclass?  Or perhaps selectSources should simply
    // return a database cursor, and SnowlService::getSources should return
    // SnowlSource objects?
    let allSources = this.getSources();
    let now = new Date();
    let staleSources = [];
    for each (let source in allSources) {
      //this._log.info(source.name + " last refreshed " + source.lastRefreshed + ", " + (now - source.lastRefreshed)/1000 + "s ago; interval is " + source.refreshInterval/1000 + "s");
      if (now - source.lastRefreshed > source.refreshInterval) {
        this._log.info("source: " + source.id + " is stale; refreshing");
        staleSources.push(source);
      }
    }
    this._refreshSources(staleSources);
  },

  refreshAllSources: function() {
    let sources = this.getSources();
    this._refreshSources(sources);
  },

  _refreshSources: function(aSources) {
    for each (let source in aSources) {
      source.refresh();

      // We reset the last refreshed timestamp here even though the refresh
      // is asynchronous, so we don't yet know whether it has succeeded.
      // The upside of this approach is that we don't keep trying to refresh
      // a source that isn't responding, but the downside is that it takes
      // a long time for us to refresh a source that is only down for a short
      // period of time.  We should instead keep trying when a source fails,
      // but with a progressively longer interval (up to the standard one).
      // FIXME: implement the approach described above.
      source.lastRefreshed = new Date();
    }
  },

  /**
   * Determine whether or not the datastore contains the message with the given ID.
   *
   * @param aExternalID {string}  the external ID of the message
   *
   * @returns {boolean} whether or not the datastore contains the message
   */
  hasMessage: function(aExternalID) {
    return SnowlDatastore.selectHasMessage(aExternalID);
  }

};

SnowlService._init();
