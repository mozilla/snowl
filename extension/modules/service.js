const EXPORTED_SYMBOLS = ["SnowlService"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://snowl/log4moz.js");

const PERMS_FILE      = 0644;
const PERMS_DIRECTORY = 0755;

const TYPE_MAYBE_FEED = "application/vnd.mozilla.maybe.feed";
const PREF_CONTENTHANDLERS_BRANCH = "browser.contentHandlers.types.";
const SNOWL_HANDLER_URI = "chrome://snowl/content/subscribe.xul?feed=%s";
const SNOWL_HANDLER_TITLE = "Snowl";

function SnowlService() {
  this._init();
}
SnowlService.prototype = {
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
    this._log = Log4Moz.Service.getLogger("Service.Main");

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
  }
};
