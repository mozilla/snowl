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

// modules that come with Firefox
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

// modules that are generic
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/Preferences.js");
Cu.import("resource://snowl/modules/URI.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/source.js");
Cu.import("resource://snowl/modules/target.js");
Cu.import("resource://snowl/modules/utils.js");

const PERMS_FILE      = 0644;
const PERMS_DIRECTORY = 0755;

const TYPE_MAYBE_FEED = "application/vnd.mozilla.maybe.feed";
const SNOWL_HANDLER_URI = "chrome://snowl/content/subscribe.xul?feed=%s";
const SNOWL_HANDLER_TITLE = "Snowl";

// How often to check if sources need refreshing, in milliseconds.
const REFRESH_CHECK_INTERVAL = 60 * 1000; // 60 seconds

let SnowlService = {
  get _prefs() {
    delete this._prefs;
    return this._prefs = new Preferences("extensions.snowl.");
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

  get _promptSvc() {
    let promptSvc =
      Cc["@mozilla.org/embedcomp/prompt-service;1"].
      getService(Ci.nsIPromptService);
    this.__defineGetter__("_promptSvc", function() { return promptSvc });
    return this._promptSvc;
  },

  _log: null,

  _init: function() {
    this._initLogging();
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

  _initLogging: function() {
    let root = Log4Moz.repository.rootLogger;
    root.level = Log4Moz.Level[this._prefs.get("log.logger.root.level")];

    let formatter = new Log4Moz.BasicFormatter();

    let capp = new Log4Moz.ConsoleAppender(formatter);
    capp.level = Log4Moz.Level[this._prefs.get("log.appender.console.level")];
    root.addAppender(capp);

    let dapp = new Log4Moz.DumpAppender(formatter);
    dapp.level = Log4Moz.Level[this._prefs.get("log.appender.dump.level")];
    root.addAppender(dapp);

    this._log = Log4Moz.repository.getLogger("Snowl.Service");
    this._log.info("initialized logging");
  },

  _registerFeedHandler: function() {
    if (this._converterSvc.getWebContentHandlerByURI(TYPE_MAYBE_FEED, SNOWL_HANDLER_URI))
      return;

    this._converterSvc.registerContentHandler(TYPE_MAYBE_FEED,
                                              SNOWL_HANDLER_URI,
                                              SNOWL_HANDLER_TITLE,
                                              null);
  },

  _accountTypeConstructors: {},
  addAccountType: function(constructor) {
    if (constructor in this._accountTypeConstructors)
      this._log.warn("constructor for " + constructor.name +
                     "already exists");
    this._accountTypeConstructors[constructor.name] = constructor;
  },

  _constructAccount: function(row) {
    let constructor = this._accountTypeConstructors[row.type];
    if (!constructor)
      throw "no constructor for type " + row.type;

    return new constructor(row.id,
                           row.type,
                           row.name,
                           URI.get(row.machineURI),
                           URI.get(row.humanURI),
                           SnowlDateUtils.julianToJSDate(row.lastRefreshed),
                           row.importance);
  },

  get _getAccountStatement() {
    delete this._getAccountStatement;
    return this._getAccountStatement = SnowlDatastore.createStatement(
      "SELECT id, type, name, machineURI, humanURI, lastRefreshed, importance " +
      "FROM sources WHERE id = :id"
    );
  },

  /**
   * Get the account with the given ID.
   * 
   * @param   id  {integer}   the ID of the account to retrieve
   */
  getAccount: function(id) {
    let account = null;

    try {
      this._getAccountStatement.params.id = id;
      if (this._getAccountStatement.step())
        account = this._constructAccount(this._getAccountStatement.row);
    }
    finally {
      this._getAccountStatement.reset();
    }

    return account;
  },

  get _accountsStatement() {
    delete this._accountsStatement;
    return this._accountsStatement = SnowlDatastore.createStatement(
      "SELECT id, type, name, machineURI, humanURI, lastRefreshed, importance " +
      "FROM sources"
    );
  },

  /**
   * Get all accounts.
   */
  get accounts() {
    let accounts = [];

    try {
      while (this._accountsStatement.step()) {
        try {
          accounts.push(this._constructAccount(this._accountsStatement.row));
        }
        catch(ex) {
          this._log.error(ex);
        }
      }
    }
    finally {
      this._accountsStatement.reset();
    }

    return accounts;
  },

  get sources() {
    return this.accounts.filter(function(acct) acct.implements(SnowlSource));
  },

  get targets() {
    return this.accounts.filter(function(acct) acct.implements(SnowlTarget));
  },

  refreshStaleSources: function() {
    this._log.info("refreshing stale sources");

    let now = new Date();
    let staleSources = [];
    for each (let source in this.sources)
      if (now - source.lastRefreshed > source.refreshInterval)
        staleSources.push(source);
    this.refreshAllSources(staleSources);
  },

  refreshAllSources: function(sources) {
    let allSources = sources ? sources : this.sources;
    for each (let source in allSources)
      this._refreshSource(source);
  },

  _refreshSource: function(source) {
      this._log.info("refreshing source " + source.name);

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
  },

  /**
   * Determine whether or not the datastore contains a source with the given URI.
   *
   * @param aMachineURI {string}  the URI to check
   *
   * @returns {boolean} whether or not the datastore contains the URI
   */
  hasSource: function(aMachineURI) {
    return SnowlDatastore.selectHasSource(aMachineURI);
  }

};

SnowlService._init();
