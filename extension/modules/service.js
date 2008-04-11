const EXPORTED_SYMBOLS = ["SnowlService"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://snowl/log4moz.js");
Cu.import("resource://snowl/datastore.js");

const PERMS_FILE      = 0644;
const PERMS_DIRECTORY = 0755;

const TYPE_MAYBE_FEED = "application/vnd.mozilla.maybe.feed";
const PREF_CONTENTHANDLERS_BRANCH = "browser.contentHandlers.types.";
const SNOWL_HANDLER_URI = "chrome://snowl/content/subscribe.xul?feed=%s";
const SNOWL_HANDLER_TITLE = "Snowl";

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

  /**
   * Reset the last refreshed time for the given source to the current time.
   *
   * XXX should this be setLastRefreshed and take a time parameter
   * to set the last refreshed time to?
   *
   * aSource {SnowlMessageSource} the source for which to set the time
   */
  resetLastRefreshed: function(aSource) {
    let stmt = SnowlDatastore.createStatement("UPDATE sources SET lastRefreshed = :lastRefreshed WHERE id = :id");
    stmt.params.lastRefreshed = new Date().getTime();
    stmt.params.id = aSource.id;
    stmt.execute();
  },

  /**
   * Determine whether or not the datastore contains the message with the given ID.
   *
   * @param aUniversalID {string}  the universal ID of the message
   *
   * @returns {boolean} whether or not the datastore contains the message
   */
  hasMessage: function(aUniversalID) {
    return SnowlDatastore.selectHasMessage(aUniversalID);
  },

  /**
   * Add a message with a single part to the datastore.
   *
   * @param aSourceID    {integer} the record ID of the message source
   * @param aUniversalID {string}  the universal ID of the message
   * @param aSubject     {string}  the title of the message
   * @param aAuthor      {string}  the author of the message
   * @param aTimestamp   {Date}    the date/time at which the message was sent
   * @param aLink        {nsIURI}  a link to the content of the message,
   *                               if the content is hosted on a server
   * @param aContent     {string}  the content of the message, if the content
   *                               is included with the message
   * @param aContentType {string}  the media type of the content of the message,
   *                               if the content is included with the message
   *
   * FIXME: allow callers to pass a set of arbitrary metadata name/value pairs
   * that get written to the attributes table.
   * 
   * @returns {integer} the internal ID of the newly-created message
   */
  addSimpleMessage: function(aSourceID, aUniversalID, aSubject, aAuthor,
                             aTimestamp, aLink, aContent, aContentType) {
    // Convert the timestamp to milliseconds-since-epoch, which is how we store
    // it in the datastore.
    let timestamp = aTimestamp ? aTimestamp.getTime() : null;

    // Convert the link to its string spec, which is how we store it
    // in the datastore.
    let link = aLink ? aLink.spec : null;

    let messageID =
      SnowlDatastore.insertMessage(aSourceID, aUniversalID, aSubject, aAuthor,
                                   timestamp, link);

    if (aContent)
      SnowlDatastore.insertPart(messageID, aContent, aContentType);

    return messageID;
  },

  addMetadatum: function(aMessageID, aAttributeName, aValue) {
    // FIXME: speed this up by caching the list of known attributes.
    let attributeID = SnowlDatastore.selectAttributeID(aAttributeName)
                      || SnowlDatastore.insertAttribute(aAttributeName);
    SnowlDatastore.insertMetadatum(aMessageID, attributeID, aValue);
  }
};

SnowlService._init();
