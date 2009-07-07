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
Cu.import("resource://snowl/modules/Observers.js");
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
  get gBrowserWindow() {
    let wm = Cc["@mozilla.org/appshell/window-mediator;1"].
             getService(Ci.nsIWindowMediator);
    delete this._gBrowserWindow;
    return this._gBrowserWindow = wm.getMostRecentWindow("navigator:browser");
  },

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

  get _ssSvc() {
    let ssSvc =
      Cc["@mozilla.org/browser/sessionstore;1"].
      getService(Ci.nsISessionStore);
    this.__defineGetter__("_ssSvc", function() { return ssSvc });
    return this._ssSvc;
  },

  _log: null,

  _init: function() {
    this._initLogging();
    this._registerFeedHandler();
    this._initTimer();

    Observers.add("snowl:source:added", this.onSourcesChanged, this);
    Observers.add("snowl:source:removed", this.onSourcesChanged, this);

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

    let logFile = this._dirSvc.get("ProfD", Ci.nsIFile);
    logFile.QueryInterface(Ci.nsILocalFile);
    logFile.append("snowl");
    logFile.append("log.txt");
    if (!logFile.exists())
      logFile.create(Ci.nsIFile.NORMAL_FILE_TYPE, PERMS_FILE);

    let fapp = new Log4Moz.RotatingFileAppender(logFile, formatter);
    fapp.level = Log4Moz.Level[this._prefs.get("log.appender.file.level")];
    root.addAppender(fapp);

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


  //**************************************************************************//
  // Event & Notification Handlers

  onSourcesChanged: function() {
    // Invalidate the cache of sources indexed by ID.
    this._sourcesByID = null;
  },


  //**************************************************************************//
  // Accounts, Sources, Targets

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
                           row.name,
                           URI.get(row.machineURI),
                           URI.get(row.humanURI),
                           row.username,
                           SnowlDateUtils.julianToJSDate(row.lastRefreshed),
                           row.importance,
                           row.placeID);
  },

  get _accountsStatement() {
    delete this._accountsStatement;
    return this._accountsStatement = SnowlDatastore.createStatement(
      "SELECT id, type, name, machineURI, humanURI, username, lastRefreshed, importance, placeID " +
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

  _sourcesByID: null,
  get sourcesByID() {
    if (!this._sourcesByID) {
      this._sourcesByID = {};
      for each (let source in this.sources)
        this._sourcesByID[source.id] = source;
    }

    return this._sourcesByID;
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

    // Set busy property, notify observer to invalidate tree.
    for each (let source in allSources)
      this.sourcesByID[source.id].busy = true;

    if (allSources.length > 0) {
      // Don't set busy on 'all' until we know when the last one is done so it
      // can be unset.
//      this._collectionStatsByCollectionID["all"].busy = true;
      Observers.notify("snowl:messages:completed", "refresh");
    }

    // We specify the same refresh time when refreshing sources so that all
    // new messages have the same received time, which makes messages sorted by
    // received, then published times look better (more mixed together by
    // publication time, not clumped up by source based on the received time)
    // when retrieved in the same refresh (f.e. when the user starts their
    // browser in the morning after leaving it off overnight).
    let refreshTime = new Date();
    for each (let source in allSources) {
      this.refreshSourceTimer(source, refreshTime);
    }
  },

  refreshSourceTimer: function(aSource, aRefreshTime) {
    let timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    let callback = { notify: function(aTimer) {
      SnowlService._log.info("refreshing source " + aSource.name);
      try {
        aSource.refresh(aRefreshTime);
        aSource.persist();
      }
      catch(ex) {
        this._log.error("error refreshing source " + aSource.name + ": " + ex);
      }
    } };

    timer.initWithCallback(callback, 10, Ci.nsITimer.TYPE_ONE_SHOT);
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
   * Determine whether or not an author has at least one message in the database.
   *
   * @param aAuthorID {string}  the author ID of the message
   *
   * @returns {boolean} whether or not the author has a message
   */
  hasAuthorMessage: function(aAuthorID) {
    return SnowlDatastore.selectHasAuthorMessage(aAuthorID);
  },

  /**
   * Determine whether or not the datastore contains a source with the given URI.
   *
   * @param aMachineURI {string}  the URI to check
   *
   * @returns {string} the name of the source if found otherwise null
   */
  hasSource: function(aMachineURI) {
    return SnowlDatastore.selectHasSource(aMachineURI);
  },

  /**
   * Determine whether or not the datastore contains a source with the given URI
   * also username for multiple subscriptions per URI. Use hasSource() for URI
   * only check.
   *
   * @param aMachineURI {string}  the URI to check
   * @param aUsername {string}  the username to check
   *
   * @returns {object} the [name, username] of the source and username if found
   *                   otherwise nulls
   */
  hasSourceUsername: function(aMachineURI, aUsername) {
    return SnowlDatastore.selectHasSourceUsername(aMachineURI, aUsername);
  },

  /**
   * Return read, unread, new stats on author, source collections.
   *
   * @returns {object} the t (total), u (unread), n (new) numbers for each
   *                   source and author collection.
   */
  _collectionStatsByCollectionID: null,
  getCollectionStatsByCollectionID: function() {
    if (!this._collectionStatsByCollectionID)
      this._collectionStatsByCollectionID = SnowlDatastore.collectionStatsByCollectionID();

    return this._collectionStatsByCollectionID;
  }

};

SnowlService._init();
