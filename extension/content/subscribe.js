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
  let statusMessage = document.getElementById("statusMessage");

  function setStatus(code, message) {
    statusBox.setAttribute("status", code);

    while (statusMessage.hasChildNodes())
      statusMessage.removeChild(statusMessage.firstChild);

    // Append a child node so it wraps if it's too long to fit on one line.
    // XXX Is there something we can do so the UI doesn't resize midstream?
    statusMessage.appendChild(document.createTextNode(message));
  }

  let identity = source.name ||
                 (source.humanURI ? source.humanURI.spec : null) ||
                 (source.machineURI ? source.machineURI.spec : null) ||
                 "unnamed source";

  switch(topic) {
    case "snowl:subscribe:connect:start":
      setStatus("active", "Connecting to " + identity);
      break;
    case "snowl:subscribe:connect:end":
      {
        let code, message;

        if (data < 200 || data > 299) {
          code = "error";
          message = "Error connecting to " + identity;
          if (data == 401) {
            message += ": your credentials were not accepted.  Please check " +
                      "your username and password and try again.";
          }
        }
        else {
          // Under most circumstances, this message will be replaced immediately
          // by the "getting messages" message.
          code = "complete";
          message = "Connected to " + identity;
        }

        setStatus(code, message);
      }
      break;
    case "snowl:subscribe:get:start":
      setStatus("active", "Getting messages for " + identity);
      break;
    case "snowl:subscribe:get:progress":
      break;
    case "snowl:subscribe:get:end":
      setStatus("complete", "You have subscribed to " + identity);
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
    let credentials = {
      username: document.getElementById("twitterUsername").value,
      password: document.getElementById("twitterPassword").value,
      remember: document.getElementById("twitterRemember").checked
    };

    let twitter = new SnowlTwitter();

    // FIXME: call this "source" instead of "feed".
    this.feed = twitter;

    twitter.subscribe(credentials);
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
