const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

// Generic modules
Cu.import("resource://snowl/modules/Observers.js");
Cu.import("resource://snowl/modules/URI.js");
Cu.import("resource://snowl/modules/log4moz.js");

// Snowl modules
Cu.import("resource://snowl/modules/service.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/feed.js");

window.addEventListener("load", function() { Subscriber.init() }, false);

function SubscriptionListener(subject, topic, data) {
  switch(topic) {
    case "snowl:subscribe:connect:start":
      document.getElementById("connectingBox").disabled = false;
      document.getElementById("connectingBox").setAttribute("status", "active");
      document.getElementById("authenticatingBox").disabled = true;
      document.getElementById("authenticatingBox").removeAttribute("status");
      document.getElementById("gettingMessagesBox").disabled = true;
      document.getElementById("gettingMessagesBox").removeAttribute("status");
      document.getElementById("doneBox").disabled = true;
      document.getElementById("doneBox").removeAttribute("status");
      break;
    case "snowl:subscribe:connect:end":
      document.getElementById("connectingBox").setAttribute("status", "complete");
      break;
    case "snowl:subscribe:authenticate:start":
      document.getElementById("authenticatingBox").disabled = false;
      document.getElementById("authenticatingBox").setAttribute("status", "active");
      break;
    case "snowl:subscribe:authenticate:end":
      document.getElementById("authenticatingBox").setAttribute("status", "complete");
      break;
    case "snowl:subscribe:get:start":
      document.getElementById("gettingMessagesBox").disabled = false;
      document.getElementById("gettingMessagesBox").setAttribute("status", "active");
      break;
    case "snowl:subscribe:get:progress":
      break;
    case "snowl:subscribe:get:end":
      document.getElementById("gettingMessagesBox").setAttribute("status", "complete");
      document.getElementById("doneBox").disabled = false;
      document.getElementById("doneBox").setAttribute("status", "complete");
      break;
  }
}

let Subscriber = {
  _log: Log4Moz.Service.getLogger("Snowl.Subscriber"),


  //**************************************************************************//
  // Initialization & Destruction

  init: function() {
    Observers.add(SubscriptionListener, "snowl:subscribe:connect:start");
    Observers.add(SubscriptionListener, "snowl:subscribe:connect:end");
    Observers.add(SubscriptionListener, "snowl:subscribe:authenticate:start");
    Observers.add(SubscriptionListener, "snowl:subscribe:authenticate:end");
    Observers.add(SubscriptionListener, "snowl:subscribe:get:start");
    Observers.add(SubscriptionListener, "snowl:subscribe:get:progress");
    Observers.add(SubscriptionListener, "snowl:subscribe:get:end");

    // Parse URL parameters
    let paramString = window.location.search.substr(1);
    let params = {};
    for each (let param in paramString.split("&")) {
      let [name, value] = param.split("=");
      if (value)
        params[name] = decodeURIComponent(value);
      else
        params[name] = value;
    }

    if (params.feed) {
      document.getElementById("snowlLocationTextbox").value = params.feed;
      this.doSubscribe();
    }
  },

  destroy: function() {
    Observers.remove(SubscriptionListener, "snowl:subscribe:connect:start");
    Observers.remove(SubscriptionListener, "snowl:subscribe:connect:end");
    Observers.remove(SubscriptionListener, "snowl:subscribe:authenticate:start");
    Observers.remove(SubscriptionListener, "snowl:subscribe:authenticate:end");
    Observers.remove(SubscriptionListener, "snowl:subscribe:get:start");
    Observers.remove(SubscriptionListener, "snowl:subscribe:get:progress");
    Observers.remove(SubscriptionListener, "snowl:subscribe:get:end");
  },


  //**************************************************************************//
  // Event Handlers

  doSubscribe: function() {
    let uri = URI.get(document.getElementById("snowlLocationTextbox").value);
    let feed = new SnowlFeed(null, null, uri);
    feed.subscribe();
  },

  doImportOPML: function() {
    let fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    fp.init(window, "Import OPML", Ci.nsIFilePicker.modeOpen);
    fp.appendFilter("OPML Files", "*.opml");
    fp.appendFilters(Ci.nsIFilePicker.filterXML);
    fp.appendFilters(Ci.nsIFilePicker.filterAll);

    let rv = fp.show();
    if (rv != Ci.nsIFilePicker.returnOK)
      return;

    let request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].
                  createInstance(Ci.nsIXMLHttpRequest);
    request.open("GET", fp.fileURL.spec, false);
    // Since the file probably ends in .opml, we have to force XHR to treat it
    // as XML by overriding the MIME type it would otherwise select.
    request.overrideMimeType("text/xml");
    request.send(null);
    let xmlDocument = request.responseXML;

    let outline = xmlDocument.getElementsByTagName("body")[0];

    this._importOutline(outline);
  },

  doClose: function() {
    window.close();
  },


  //**************************************************************************//
  // OPML Import

  _importOutline: strand(function(aOutline) {
    // If this outline represents a feed, subscribe the user to the feed.
    let uri = URI.get(aOutline.getAttribute("xmlUrl"));
    if (uri) {
      // FIXME: make sure the user isn't already subscribed to the feed
      // before subscribing her to it.
      let name = aOutline.getAttribute("title") || aOutline.getAttribute("text");
      document.getElementById("sourceTitle").value = "Subscribing to " + (name || uri.spec);
      var future = new Future();
      new SnowlFeed(null, name || "untitled", uri).subscribe(future.fulfill);
      yield future.result();
    }

    if (aOutline.hasChildNodes()) {
      let children = aOutline.childNodes;
      for (let i = 0; i < children.length; i++) {
        let child = children[i];

        // Only deal with "outline" elements; ignore text, etc. nodes.
        if (child.nodeName != "outline")
          continue;

        yield this._importOutline(child);
      }
    }
  })

};
