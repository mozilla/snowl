const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

// modules that come with Firefox
Cu.import("resource://gre/modules/XPCOMUtils.jsm");

// modules that should come with Firefox
Cu.import("resource://snowl/modules/Observers.js");
Cu.import("resource://snowl/modules/URI.js");
Cu.import("resource://snowl/modules/log4moz.js");

// Snowl-specific modules
Cu.import("resource://snowl/modules/service.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/feed.js");
Cu.import("resource://snowl/modules/twitter.js");

window.addEventListener("load", function() { Subscriber.init() }, false);

function SubscriptionListener(subject, topic, data) {
  let source = Subscriber.feed;

  // Don't track the status of subscriptions happening in other windows/tabs.
  if (subject != source)
    return;

  let statusBox = document.getElementById("statusBox");
  let statusText = document.getElementById("statusText");

  let identity = source.name ||
                 (source.humanURI ? source.humanURI.spec : null) ||
                 (source.machineURI ? source.machineURI.spec : null) ||
                 "unnamed source";

  switch(topic) {
    case "snowl:subscribe:connect:start":
      statusBox.setAttribute("status", "active");
      statusText.value = "Connecting to " + identity;
      break;
    case "snowl:subscribe:connect:end":
      if (data < 200 || data > 299) {
        statusBox.setAttribute("status", "error");
        statusBox.value = "Error connecting to " + identity;
      }
      else {
        // XXX Should we bother setting this when we're going to change it
        // to "getting messages" an instant later?
        statusBox.setAttribute("status", "complete");
        statusBox.value = "Connected to " + identity;
      }
      break;
    case "snowl:subscribe:get:start":
      statusBox.setAttribute("status", "active");
      statusText.value = "Getting messages for " + identity;
      break;
    case "snowl:subscribe:get:progress":
      break;
    case "snowl:subscribe:get:end":
      statusBox.setAttribute("status", "complete");
      //statusText.value = "Got messages for " + identity;
      statusText.value = "You have subscribed to " + identity;
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
    Observers.remove(SubscriptionListener, "snowl:subscribe:get:start");
    Observers.remove(SubscriptionListener, "snowl:subscribe:get:progress");
    Observers.remove(SubscriptionListener, "snowl:subscribe:get:end");
  },


  //**************************************************************************//
  // Event Handlers

  doSubscribe: function() {
    let uri = URI.get(document.getElementById("snowlLocationTextbox").value);
    let feed = new SnowlFeed(null, null, uri);
    this._subscribe(feed);
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

    // FIXME: use a file utility to open the file instead of XMLHttpRequest.
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

  showTwitterPassword: function() {
    if (document.getElementById("showPassword").checked)
      document.getElementById("twitterPassword").removeAttribute("type");
    else
      document.getElementById("twitterPassword").setAttribute("type", "password");
  },

  subscribeTwitter: function() {
    let machineURI = URI.get("https://twitter.com");
    let humanURI = URI.get("http://twitter.com/home");
    let twitter = new SnowlTwitter(null, "Twitter", machineURI, humanURI);

    let username = document.getElementById("twitterUsername").value;
    let password = document.getElementById("twitterPassword").value;

    twitter.verify(username, password, function(response) { alert("twitter verify callback: " + response) });

    //{"authorized":true}
    //Could not authenticate you.
  },

  //**************************************************************************//
  // OPML Import

  _importOutline: strand(function(aOutline) {
    // If this outline represents a feed, subscribe the user to the feed.
    let uri = URI.get(aOutline.getAttribute("xmlUrl"));
    if (uri) {
      let name = aOutline.getAttribute("title") || aOutline.getAttribute("text");
      let feed = new SnowlFeed(null, name || "untitled", uri);

      let future = new Future();
      this._subscribe(feed, future.fulfill);
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
  }),

  _subscribe: strand(function(feed, callback) {
    // FIXME: make sure the user isn't already subscribed to the feed
    // before subscribing them to it.

    // Store a reference to the feed to which we are currently subscribing
    // so the progress listener can filter out events for some other feed.
    this.feed = feed;

    let future = new Future();
    feed.subscribe(future.fulfill);
    yield future.result();

    this.feed = null;

    if (callback)
      callback();
  })

};
