const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");

const PREF_CONTENTHANDLERS_BRANCH = "browser.contentHandlers.types.";
const TYPE_MAYBE_FEED = "application/vnd.mozilla.maybe.feed";
const SNOWL_HANDLER_URI = "chrome://snowl/content/subscribe.xul?feed=%s";
const SNOWL_HANDLER_TITLE = "Snowl";

function SnowlRegistrationService() {
  dump("SnowlRegistrationService\n");
}

SnowlRegistrationService.prototype = {
  classDescription: "Snowl Registration Service",
  contractID: "@mozilla.org/snowl/registration-service;1",
  classID: Components.ID("{688ded17-a02f-4dd9-9d40-1967e2bd2916}"),
  _xpcom_categories: [{ category: "xpcom-startup", service: true }],
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver]),
  
  observe: function(aSubject, aTopic, aData) {
    dump("SnowlRegistrationService: " + aTopic + "\n");
return;

    switch(aTopic) {
      case "xpcom-startup":
        //Cc["@mozilla.org/categorymanager;1"].getService(Ci.nsICategoryManager).
        //addObserver(this, "profile-after-change", false);
        break;
      case "app-startup":
        Cc["@mozilla.org/observer-service;1"].
          getService(Ci.nsIObserverService).
          addObserver(this, "profile-after-change", false);
        break;
      case "profile-after-change":
        try {
          this._registerFeedHandler();
        }
        catch(ex) {
          dump("SnowlRegistrationService::observe: " + ex + "\n");
          throw ex;
        }
        break;
    }
  },

  _registerFeedHandler: function(aContentType, aURI, aTitle) {
return;
    var ps = 
        Cc["@mozilla.org/preferences-service;1"].
        getService(Ci.nsIPrefService);
    var i = 0;
    var typeBranch = null;
    while (true) {
      typeBranch = 
        ps.getBranch(PREF_CONTENTHANDLERS_BRANCH + i + ".");
      try {
        let type = typeBranch.getCharPref("type");
        let uri = typeBranch.getCharPref("uri");
dump("SnowlRegistrationService::_registerFeedHandler: " + uri + "\n");
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
      ps.savePrefFile(null);
dump("finished\n");
    }
  }
};

function NSGetModule(compMgr, fileSpec) {
  return XPCOMUtils.generateModule([SnowlRegistrationService]);
}
