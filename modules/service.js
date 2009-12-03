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
 *   alta88 <alta88@gmail.com>
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
Cu.import("resource://snowl/modules/Mixins.js");
Cu.import("resource://snowl/modules/Observers.js");
Cu.import("resource://snowl/modules/Preferences.js");
Cu.import("resource://snowl/modules/URI.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/constants.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/message.js");
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
// How often to check message retention policies, in milliseconds.
// TODO: retention check run based on last run.
const RETENTION_CHECK_INTERVAL = 60 * 1000 * 60 * 12 ; // 12 hours
//const RETENTION_CHECK_INTERVAL = 30 * 1000; // 30 seconds

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
    this._initRefreshTimer();
    this._initRetentionTimer();

    Observers.add("snowl:source:added",    this.onSourcesChanged, this);
    Observers.add("snowl:source:unstored", this.onSourcesChanged, this);
  },

  _refreshTimer: null,
  _initRefreshTimer: function() {
    this._refreshTimer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    let callback = {
      _svc: this,
      notify: function(aTimer) { this._svc.refreshStaleSources() }
    };
    this._refreshTimer.initWithCallback(callback,
                                        REFRESH_CHECK_INTERVAL,
                                        Ci.nsITimer.TYPE_REPEATING_SLACK);
  },

  _retentionTimer: null,
  _initRetentionTimer: function() {
    this._retentionTimer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    let callback = {
      _svc: this,
      notify: function(aTimer) { this._svc.retentionCheck() }
    };
    this._retentionTimer.initWithCallback(callback,
                                          RETENTION_CHECK_INTERVAL,
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
    this._targetsByID = null;
  },


  //**************************************************************************//
  // Accounts, Sources, Targets

  _accountTypeConstructors: {},
  addAccountType: function(constructor, typeAttributes) {
    if (constructor in this._accountTypeConstructors)
      this._log.warn("constructor for " + constructor.name +
                     "already exists");
    this._accountTypeConstructors[constructor.name] = constructor;

    if (!this.hasSource(constructor.name)) {
      // Create a record for an account type, eq SnowlFeed or SnowlTwitter, that
      // will contain global attributes for that source type.
      this.insertSourceType(constructor.name,
                            "SnowlAccountType",
                            constructor.name,
                            SnowlDateUtils.jsToJulianDate(new Date),
                            typeAttributes);
    }

    // XXX: probably better to do this on a db version change within database.js,
    // but the source type objects don't seem to be ready.
    this.initAccountAttributes(constructor, typeAttributes);
  },

  get _initAccountAttributesStatement() {
    let statement = SnowlDatastore.createStatement(
      "SELECT id, type, name, machineURI, humanURI, username, " +
      "       lastRefreshed, importance, placeID, attributes " +
      "FROM sources " +
      "WHERE type = :type OR machineURI = :type");
    this.__defineGetter__("_initAccountAttributesStatement", function() { return statement });
    return this._initAccountAttributesStatement;
  },

  // If attributes are added or removed in the global source or individual
  // source types, the db needs to be updated.  For existing attributes, the
  // values persisted in the db must be retained.
  initAccountAttributes: function(constructor, typeAttributes) {
    let account = {}, meldAttributes = {}, count = 1;

    try {
      this._initAccountAttributesStatement.params.type = constructor.name;
      while (this._initAccountAttributesStatement.step()) {
        account = this._constructAccount(this._initAccountAttributesStatement.row);
        meldAttributes = typeAttributes;
        Mixins.meld(account.attributes, false, true, SnowlService._log).into(meldAttributes);
        // Meld any existing db attributes into new typeAttributes; those removed
        // are thus tossed.  Set new account attributes back and persist.
        account.attributes = meldAttributes;
        account.persistAttributes();
      }
    }
    finally {
      this._initAccountAttributesStatement.reset();
    }

  },

  _constructAccount: function(row) {
    let type = row.type == "SnowlAccountType" ? row.machineURI : row.type;
    let constructor = this._accountTypeConstructors[type];
    if (!constructor)
      throw "no constructor for type " + row.type;

    return new constructor(row.id,
                           row.name,
                           URI.get(row.machineURI),
                           URI.get(row.humanURI),
                           row.username,
                           SnowlDateUtils.julianToJSDate(row.lastRefreshed),
                           row.importance,
                           row.placeID,
                           JSON.parse(row.attributes));
  },

  get _accountsStatement() {
    delete this._accountsStatement;
    return this._accountsStatement = SnowlDatastore.createStatement(
      "SELECT id, type, name, machineURI, humanURI, username, " +
      "       lastRefreshed, importance, placeID, attributes " +
      "FROM sources"
    );
  },

  /**
   * Get all accounts.  For types SnowlAccountType, store separately.
   */
  _accountTypesByType: {},
  get accounts() {
    let accounts = [];
    try {
      while (this._accountsStatement.step()) {
        try {
          if (this._accountsStatement.row.type == "SnowlAccountType")
            this._accountTypesByType[this._accountsStatement.row.machineURI] =
                this._constructAccount(this._accountsStatement.row);
          else
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

  _targetsByID: null,
  get targetsByID() {
    if (!this._targetsByID) {
      this._targetsByID = {};
      for each (let target in this.targets)
        this._targetsByID[target.id] = target;
    }

    return this._targetsByID;
  },

  refreshStaleSources: function() {
    // This used to check SnowlPlaces._placesConverted, but that property
    // doesn't seem to get set to true after SnowlPlaces::delayedInit gets run
    // on startup, and we should always refresh stale sources when requested
    // to do so, even if Places hasn't been converted yet.  In fact, we should
    // refresh them even if Places isn't initialized, since only one view
    // in Snowl depends on Places, and the rest of Snowl shouldn't be made
    // to depend on Snowl's Places integration being ready.
    // FIXME: replace this check with one in SnowlPlaces that handles any
    // refreshes that have taken place before the Places integration was
    // initialized/converted.
    if (!SnowlPlaces._placesInitialized) {
      this._log.info("not refreshing stale sources, as Places integration not inited");
      return;
    }

    this._log.debug("refreshing stale sources");

    let now = new Date();
    let staleSources = [];
    for each (let source in this.sourcesByID) {
      if (now - source.lastRefreshed > source.refreshInterval &&
          !this.sourcesByID[source.id].busy &&
          source.attributes.refresh["status"] != "paused" &&
          source.attributes.refresh["status"] != "disabled")
        // Do not autorefresh (as opposed to user initiated refresh) if a source
        // is permanently disabled (404 error eg) or paused or busy.
        staleSources.push(source);
    }
    this.refreshAllSources(staleSources);
  },

  get refreshingCount() {
    return this._refreshingCount ? this._refreshingCount : this._refreshingCount = 0;
  },
  
  set refreshingCount(val) {
    return this._refreshingCount = val;
  },

  refreshAllSources: function(sources) {
    let cachedsource, refreshSources = [];
    let allSources = sources ? sources : this.sourcesByID;

    if (this.refreshingCount > 0)
      // Do not refresh if any source in the current cycle is not finished.
      return;

    // Set busy property, reset states.
    for each (let source in allSources) {
      cachedsource = this.sourcesByID[source.id];
      if (cachedsource) {
        cachedsource.busy = true;
        cachedsource.error = false;
        if (cachedsource.attributes.refresh["status"] != "paused")
          cachedsource.attributes.refresh["status"] = "active";
        cachedsource.persistAttributes();
      }

      refreshSources.push(source);
      this.refreshingCount = ++this.refreshingCount;
    }

    this._log.debug("refreshAllSources: count - "+this.refreshingCount);

    if (refreshSources.length > 0)
      // Invalidate collections tree to show new state.  Also disable list view
      // refresh button so no db concurrency trouble.
      Observers.notify("snowl:messages:completed", "refresh");

    // We specify the same refresh time when refreshing sources so that all
    // new messages have the same received time, which makes messages sorted by
    // received, then published times look better (more mixed together by
    // publication time, not clumped up by source based on the received time)
    // when retrieved in the same refresh (f.e. when the user starts their
    // browser in the morning after leaving it off overnight).
    let refreshTime = new Date();
    for each (let source in refreshSources)
      this.refreshSourceTimer(source, refreshTime);
  },

  refreshSourceTimer: function(aSource, aRefreshTime) {
    let timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    let callback = { notify: function(aTimer) {
      SnowlService._log.info("Refreshing source: " +
          aSource.name + " - " + aSource.machineURI.spec);
      try {
        aSource.refresh(aRefreshTime);
      }
      catch(ex) {
        aSource.attributes.refresh["text"] = ex;
        aSource.onRefreshError();
      }
      try {
        aSource.persist(true);
      }
      catch(ex) {
        aSource.attributes.refresh["text"] = ex;
        aSource.onDbError();
      }
    } };

    timer.initWithCallback(callback, 10, Ci.nsITimer.TYPE_ONE_SHOT);
  },


  /**
   * Determine whether or not, and by what policy, to mark messages deleted
   * according to individual source and global source type settings.
   *
   */
  retentionCheck: function() {
    let query, daysOld, daysOldDate, daysOldDateJulian, messagesNumber, keepFlagged;
    let skipTypes = {}, byNumberTypes = {}, typeAttributes;
    let now = new Date();

    let selectStr    = "SELECT id WHERE";
    let acctTypeStr  = " sourceID IN (SELECT id from sources WHERE type = ";
    let sourceStr    = " sourceID = ";
    let byDaysStr1   = " AND ( CASE WHEN timestamp ISNULL THEN received < ";
    let byDaysStr2   = "            ELSE timestamp < ";
    let byDaysStr3   = "       END )";
    let byNumberStr1 = " AND id NOT IN ( SELECT id FROM messages WHERE sourceID = ";
    let byNumberStr2 = "                 ORDER BY id DESC LIMIT ";
    let flaggedStr   = " AND id NOT IN ( SELECT id FROM messages WHERE attributes " +
                       "                 REGEXP 'FLAGGED_TRUE' )";
    let deletedStr   = " AND ( current = " + MESSAGE_NON_CURRENT + " OR" +
                       "       current = " + MESSAGE_CURRENT + " )";

    // Preprocessing for higher probability cases; skip unnecessary per source
    // checks by using broader sql statements.
    for each (let accountType in this._accountTypesByType) {
//this._log.info("retentionCheck: accountType:attrs - "+accountType.name+" : " +accountType.attributes.toSource());
      query = null;
      if (accountType.attributes.retention.useDefault) {
        if (accountType.attributes.retention.deleteBy == MESSAGE_NODELETE) {
//this._log.info("retentionCheck: accountType0:query - "+accountType.name+" : " +query);
          skipTypes[accountType.name] = accountType.name;
//          continue;
        }
        if (accountType.attributes.retention.deleteBy == MESSAGE_BYMESSAGESNUMBER) {
          // Delete > number of messages.  Must be handled on per source basis..
          byNumberTypes[accountType.name] = accountType.name;

//this._log.info("retentionCheck: accountType1:query - "+accountType.name+" : " +query);
//          continue;
        }
        if (accountType.attributes.retention.deleteBy == MESSAGE_BYDAYSOLD) {
          // Delete > days old messages.  Convert to julian date stored in db.
          daysOld = accountType.attributes.retention.deleteDays;
          daysOldDate = now - (daysOld * 1000 * 60 * 60 * 24);
          daysOldDateJulian = SnowlDateUtils.jsToJulianDate(new Date(daysOldDate));
          keepFlagged = accountType.attributes.retention.keepFlagged;
          query = selectStr;
          query += acctTypeStr + "'" + accountType.name + "')";
          query += byDaysStr1 + daysOldDateJulian;
          query += byDaysStr2 + daysOldDateJulian;
          query += byDaysStr3;
          query += keepFlagged ? flaggedStr : "";
          query += deletedStr;
//this._log.info("retentionCheck: accountType2:query - "+accountType.name+" : " +query);
          skipTypes[accountType.name] = accountType.name;
          this.retentionDeleteTimer(accountType.name, query);
//          continue;
        }
      }
//this._log.info("retentionCheck: accountType:query - "+accountType.name+" : " +query);
    }

    if (skipTypes.__count__ == this._accountTypesByType.__count__)
      // All account types have useDefault=true, and default is either 'no delete'
      // or 'delete by days old' (handled above).
      return;

//this._log.info("retentionCheck: gotAction");

/**/
    for each (let source in this.sourcesByID) {
      query = null;
      daysOld = null;
      messagesNumber = null;
      keepFlagged = null;

      typeAttributes = this._accountTypesByType[source.constructor.name].attributes;
//this._log.info("retentionCheck: source - "+source.name);
//this._log.info("retentionCheck: source.constructor.name - " +source.constructor.name);
      if (source.constructor.name in skipTypes ||
          (!source.constructor.name in byNumberTypes &&
          ((source.attributes.retention.useDefault &&
           typeAttributes.retention.deleteBy == MESSAGE_NODELETE) ||
          (!source.attributes.retention.useDefault &&
           source.attributes.retention.deleteBy == MESSAGE_NODELETE)))) {
        // The type for this source has already been handled, or useDefault for
        // this source is true and source type default is 'no delete' (source
        // type useDefault override is not set to true), or useDefault is false
        // and setting is 'no delete'.
//this._log.info("retentionCheck: source No Delete - "+source.name);
        continue;
      }
//this._log.info("retentionCheck: source.constructor.name - " +source.constructor.name);
      if (source.constructor.name in byNumberTypes) {
//this._log.info("retentionCheck: source - "+source.name);
        // Default override set for source type, delete by number of messages.
        messagesNumber = typeAttributes.retention.deleteNumber;
        keepFlagged = typeAttributes.retention.keepFlagged;
      }
      else {
        if (source.attributes.retention.useDefault) {
          if (typeAttributes.retention.deleteBy == MESSAGE_BYDAYSOLD)
            daysOld = typeAttributes.retention.deleteDays;
          if (typeAttributes.retention.deleteBy == MESSAGE_BYMESSAGESNUMBER)
            messagesNumber = typeAttributes.retention.deleteNumber;
          keepFlagged = typeAttributes.retention.keepFlagged;
        }
        else {
          if (source.attributes.retention.deleteBy == MESSAGE_BYDAYSOLD)
            daysOld = source.attributes.retention.deleteDays;
          if (source.attributes.retention.deleteBy == MESSAGE_BYMESSAGESNUMBER)
            messagesNumber = source.attributes.retention.deleteNumber;
          keepFlagged = source.attributes.retention.keepFlagged;
        }
      }

      if (daysOld) {
        // Convert to julian date stored in db.
        daysOldDate = now - (daysOld * 1000 * 60 * 60 * 24);
        daysOldDateJulian = SnowlDateUtils.jsToJulianDate(new Date(daysOldDate));
        query = selectStr;
        query += sourceStr + source.id;
        query += byDaysStr1 + daysOldDateJulian;
        query += byDaysStr2 + daysOldDateJulian;
        query += byDaysStr3;
        query += keepFlagged ? flaggedStr : "";
        query += deletedStr;
      }
      else if (messagesNumber) {
        query = selectStr;
        query += sourceStr + source.id;
        query += byNumberStr1 + source.id;
        query += byNumberStr2 + messagesNumber + " )";
        query += keepFlagged ? flaggedStr : "";
        query += deletedStr;
      }

//this._log.info("retentionCheck: source:query - "+source.name+" : " +query);
      if (query)
        this.retentionDeleteTimer(source.name, query);
    }

    // Refresh the collections tree.
    this._collectionStatsByCollectionID = null;
    Observers.notify("snowl:messages:completed", "refresh");
  },

  retentionDeleteTimer: function(sourceName, query) {
    let timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    let callback = { notify: function(aTimer) {
      SnowlService._log.info("Message retention cleanup: " + sourceName + " : " +query);
      try {
        SnowlMessage.markDeletedState(query, true);
      }
      catch(ex) {
        // FIXME: Errors here are likely due to db lock concurrency.  Either
        // wait for next cycle or reset interval and try again for X times etc.
//        throw (ex);
      }
    } };

    timer.initWithCallback(callback, 100, Ci.nsITimer.TYPE_ONE_SHOT);
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
  hasIdentityMessage: function(aAuthorID) {
    return SnowlDatastore.selectHasIdentityMessage(aAuthorID);
  },

  /**
   * Determine whether or not an author has at least one identity in the database.
   *
   * @param aAuthorID {string}  the identity ID of the message
   *
   * @returns {boolean} whether or not the author has an identity
   */
  hasAuthorIdentity: function(aAuthorID) {
    return SnowlDatastore.selectHasAuthorIdentity(aAuthorID);
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
   * Store into sources a SnowlAccountType record, for each type of source, to
   * contain default attributes.
   *
   * @param aName          {string}  the name
   * @param aType          {string}  the system source type 'SnowlAccountType'
   * @param aMachineURI    {string}  the type of source
   * @param aLastRefreshed {date}  the date
   * @param aAttributes    {string}  the JSON attribute string
   *
   * @returns {integer} the id of the new record.
   */
  insertSourceType: function(aName, aType, aMachineURI, aLastRefreshed, aAttributes) {
    return SnowlDatastore.insertSourceType(aName, aType, aMachineURI, aLastRefreshed, aAttributes);
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
