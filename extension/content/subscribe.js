let Subscriber = {
  // Observer Service
  get _obsSvc() {
    let obsSvc = Cc["@mozilla.org/observer-service;1"].
                 getService(Ci.nsIObserverService);
    delete this._obsSvc;
    this._obsSvc = obsSvc;
    return this._obsSvc;
  },

  _log: null,
  _feedURL: null,

  QueryInterface: function(aIID) {
    if (aIID.equals(Ci.nsIFeedResultListener) ||
        aIID.equals(Ci.nsISupports))
      return this;

    throw Cr.NS_ERROR_NO_INTERFACE;
  },

  init: function() {
    this._log = Log4Moz.Service.getLogger("Snowl.Subscriber");

    // Parse URL parameters
    let paramString = window.location.search.substr(1);
    let params = {};
    for each (let param in paramString.split("&")) {
      let [name, value] = param.split("=");
      params[name] = decodeURIComponent(value);
    }
    this._feedURL = params.feed;

    let subscription = this.getSubscription(this._feedURL);
    if (subscription) {
      this._appendMessage("You are already subscribed to '" + subscription.title + "'.");
    }
    else {
      this._appendMessage("Retrieving feed...", "retrievingFeedMessage");

      let request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance();

      request = request.QueryInterface(Ci.nsIDOMEventTarget);
      request.addEventListener("load", this, false);
      request.addEventListener("error", this, false);

      request = request.QueryInterface(Ci.nsIXMLHttpRequest);
      request.open("GET", params.feed, true);
      request.send(null);
    }
  },

  _appendMessage: function(aMessage, aID) {
    let description = document.createElement("description");
    if (aID)
      description.setAttribute("id", aID);
    let textNode = document.createTextNode(aMessage);
    description.appendChild(textNode);
    document.getElementById("messages").appendChild(description);
  },

  getSubscription: function(aURL) {
    let statement = SnowlDatastore.createStatement("SELECT id, title FROM sources WHERE url = :url");
    statement.params.url = aURL;

    try {
      if (statement.step())
        return { id: statement.row.id, title: statement.row.title };
    }
    finally {
      statement.reset();
    }

    return null;
  },

  handleEvent: function(aEvent) {
    switch(aEvent.type) {
      case "load":
        this.onLoad(aEvent);
        break;
      case "error":
        this.onError(aEvent);
        break;
    }
  },

  onLoad: function(aEvent) {
    let request = aEvent.target;

    // FIXME: notify the user about the problem.
    if (request.responseText.length == 0)
      throw("feed contains no data");

    let message = document.createTextNode(" done.");
    document.getElementById("retrievingFeedMessage").appendChild(message);

    let parser = Cc["@mozilla.org/feed-processor;1"].
                 createInstance(Ci.nsIFeedProcessor);
    //parser.listener = new SnowlFeed(request.channel.originalURI);
    parser.listener = this;
    parser.parseFromString(request.responseText, request.channel.URI);
  },

  // nsIFeedResultListener

  handleResult: function(aResult) {
    let feed = aResult.doc.QueryInterface(Components.interfaces.nsIFeed);

    // Subscribe to the feed.
    this._log.info("subscribing to " + this._feedURL);
    let statement = SnowlDatastore.createStatement("INSERT INTO sources (url, title) VALUES (:url, :title)");
    statement.params.url = this._feedURL;
    statement.params.title = feed.title.plainText();
    statement.step();

    let sourceID = SnowlDatastore.dbConnection.lastInsertRowID;

    // Now refresh the feed to import all its items.
    this._log.info("refreshing " + this._feedURL);
    let feed2 = new SnowlFeed(sourceID, this._feedURL);
try {
    this._appendMessage("Downloading entries...", "downloadingEntriesMessage");
    feed2.handleResult(aResult);
    let message = document.createTextNode(" done.");
    document.getElementById("downloadingEntriesMessage").appendChild(message);
}
catch(ex) {
  Components.utils.reportError(ex);
}

    this._appendMessage("You have been subscribed to '" + feed.title.plainText() + "'.");
    this._obsSvc.notifyObservers(null, "messages:changed", null);
  },

  onClose: function() {
    window.close();
  }

};

window.addEventListener("load", function() { Subscriber.init() }, false);
