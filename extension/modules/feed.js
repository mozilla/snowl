EXPORTED_SYMBOLS = ["SnowlFeed", "SnowlFeedSubscriber"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

// FIXME: factor this out into a common file.
const PART_TYPE_CONTENT = 1;
const PART_TYPE_SUMMARY = 2;

Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/URI.js");

var SnowlFeedClient = {
  // XXX Make this take a feed ID once it stores the list of subscribed feeds
  // in the datastore.
  refresh: function(aFeedURL) {
    let request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance();

    request.QueryInterface(Ci.nsIDOMEventTarget);
    let t = this;
    request.addEventListener("load", function(aEvent) { t.onLoad(aEvent) }, false);
    request.addEventListener("error", function(aEvent) { t.onError(aEvent) }, false);

    request.QueryInterface(Ci.nsIXMLHttpRequest);
    request.open("GET", aFeedURL, true);
    request.send(null);
  },

  onLoad: function(aEvent) {
    let request = aEvent.target;

    if (request.responseText.length > 0) {
      let parser = Cc["@mozilla.org/feed-processor;1"].
                   createInstance(Ci.nsIFeedProcessor);
      parser.listener = new SnowlFeed(request.channel.originalURI);
      parser.parseFromString(request.responseText, request.channel.URI);
    }
  },

  onError: function(aEvent) {
    // FIXME: figure out what to do here.
    Log4Moz.Service.getLogger("Snowl.FeedClient").error("loading feed " + aEvent.target.channel.originalURI.spec);
  }
};

function SnowlFeed(aID, aURL, aTitle) {
  this.id = aID;
  this.url = aURL;
  this.title = aTitle;

  this._log = Log4Moz.Service.getLogger("Snowl.Feed");
}

// FIXME: make this a subclass of SnowlSource.

SnowlFeed.prototype = {
  id: null,
  url: null,
  title: null,

  _log: null,

  QueryInterface: function(aIID) {
    if (aIID.equals(Ci.nsIFeedResultListener) ||
        aIID.equals(Ci.nsISupports))
      return this;

    throw Cr.NS_ERROR_NO_INTERFACE;
  },

  // nsIFeedResultListener

  handleResult: function(result) {
    // Now that we know we successfully downloaded the feed and obtained
    // a result from it, update the "last refreshed" timestamp.
    this.resetLastRefreshed(this);

    let feed = result.doc.QueryInterface(Components.interfaces.nsIFeed);

    let currentMessages = [];

    SnowlDatastore.dbConnection.beginTransaction();
    try {
      for (let i = 0; i < feed.items.length; i++) {
        let entry = feed.items.queryElementAt(i, Ci.nsIFeedEntry);
        //entry.QueryInterface(Ci.nsIFeedContainer);

        // Figure out the ID for the entry, then check if the entry has already
        // been retrieved.  If we can't figure out the entry's ID, then we skip
        // the entry, since its ID is the only way for us to know whether or not
        // it has already been retrieved.
        let externalID;
        try {
          externalID = entry.id || this.generateID(entry);
        }
        catch(ex) {
          this._log.warn(this.title + " couldn't retrieve a message: " + ex);
          continue;
        }

        let internalID = this.getInternalIDForExternalID(externalID);

        if (internalID) {
          //this._log.info(this.title + " has message " + externalID);
        }
        else {
          //this._log.info(this.title + " adding message " + externalID);
          internalID = this.addMessage(entry, externalID);
        }

        currentMessages.push(internalID);
      }

      // Update the current flag.
      SnowlDatastore.dbConnection.executeSimpleSQL("UPDATE messages SET current = 0 WHERE sourceID = " + this.id);
      SnowlDatastore.dbConnection.executeSimpleSQL("UPDATE messages SET current = 1 WHERE sourceID = " + this.id + " AND id IN (" + currentMessages.join(", ") + ")");

      SnowlDatastore.dbConnection.commitTransaction();
    }
    catch(ex) {
      SnowlDatastore.dbConnection.rollbackTransaction();
      throw ex;
    }
  },

  // nsIFeedTextConstruct::type to media type mappings.
  mediaTypes: { html: "text/html", xhtml: "application/xhtml+xml", text: "text/plain" },

  getNewMessages: function() {
    let request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance();

    request.QueryInterface(Ci.nsIDOMEventTarget);
    // FIXME: just pass "this" and make this implement nsIDOMEventListener.
    let t = this;
    request.addEventListener("load", function(aEvent) { t.onLoad(aEvent) }, false);
    request.addEventListener("error", function(aEvent) { t.onError(aEvent) }, false);

    request.QueryInterface(Ci.nsIXMLHttpRequest);
//dump("about to getNewMessages for " + this.url + "\n");
    request.open("GET", this.url, true);
    request.send(null);
  },

  onLoad: function(aEvent) {
    let request = aEvent.target;

    if (request.responseText.length > 0) {
      let parser = Cc["@mozilla.org/feed-processor;1"].
                   createInstance(Ci.nsIFeedProcessor);
      parser.listener = this;
      parser.parseFromString(request.responseText, request.channel.URI);
    }
  },

  onError: function(aEvent) {
    // FIXME: figure out what to do here.
    this._log.error("loading feed " + aEvent.target.channel.originalURI);
  },

  /**
   * Add a message to the datastore for the given feed entry.
   *
   * @param aEntry        {nsIFeedEntry}  the feed entry
   * @param aExternalID   {string}        the external ID of the feed entry
   */
  addMessage: function(aEntry, aExternalID) {
    // Combine the first author's name and email address into a single string
    // that we'll use as the author of the message.
    let author = null;
    if (aEntry.authors.length > 0) {
      let firstAuthor = aEntry.authors.queryElementAt(0, Ci.nsIFeedPerson);
      let name = firstAuthor.name;
      let email = firstAuthor.email;
      if (name) {
        author = name;
        if (email)
          author += " <" + email + ">";
      }
      else if (email)
        author = email;
    }

    // Convert the publication date/time string into a JavaScript Date object.
    let timestamp = aEntry.published ? new Date(aEntry.published) : null;

    // FIXME: wrap all queries that add the message into a transaction?

    // FIXME: handle titles that contain markup or are missing.
    let messageID = this.addSimpleMessage(this.id, aExternalID,
                                          aEntry.title.text, author,
                                          timestamp, aEntry.link);

    // Add parts
    if (aEntry.content) {
      this.addPart(messageID, PART_TYPE_CONTENT, aEntry.content.text,
                   (aEntry.content.base ? aEntry.content.base.spec : null),
                   aEntry.content.lang, this.mediaTypes[aEntry.content.type]);
    }

    if (aEntry.summary) {
      this.addPart(messageID, PART_TYPE_SUMMARY, aEntry.summary.text,
                   (aEntry.summary.base ? aEntry.summary.base.spec : null),
                   aEntry.summary.lang, this.mediaTypes[aEntry.summary.type]);
    }

    // Add metadata.
    let fields = aEntry.QueryInterface(Ci.nsIFeedContainer).
                 fields.QueryInterface(Ci.nsIPropertyBag).enumerator;
    while (fields.hasMoreElements()) {
      let field = fields.getNext().QueryInterface(Ci.nsIProperty);

      if (field.name == "authors") {
        let values = field.value.QueryInterface(Ci.nsIArray).enumerate();
        while (values.hasMoreElements()) {
          let value = values.getNext().QueryInterface(Ci.nsIFeedPerson);
          // FIXME: store people records in a separate table with individual
          // columns for each person attribute (i.e. name, email, url)?
          this.addMetadatum(messageID,
                                    "atom:author",
                                    value.name && value.email ? value.name + "<" + value.email + ">"
                                                              : value.name ? value.name : value.email);
        }
      }

      else if (field.name == "links") {
        let values = field.value.QueryInterface(Ci.nsIArray).enumerate();
        while (values.hasMoreElements()) {
          let value = values.getNext().QueryInterface(Ci.nsIPropertyBag2);
          // FIXME: store link records in a separate table with individual
          // colums for each link attribute (i.e. href, type, rel, title)?
          this.addMetadatum(messageID,
                                    "atom:link_" + value.get("rel"),
                                    value.get("href"));
        }
      }

      // For some reason, the values of certain simple fields (like RSS2 guid)
      // are property bags containing the value instead of the value itself.
      // For those, we need to unwrap the extra layer. This strange behavior
      // has been filed as bug 427907.
      else if (typeof field.value == "object") {
        if (field.value instanceof Ci.nsIPropertyBag2) {
          let value = field.value.QueryInterface(Ci.nsIPropertyBag2).get(field.name);
          this.addMetadatum(messageID, field.name, value);
        }
        else if (field.value instanceof Ci.nsIArray) {
          let values = field.value.QueryInterface(Ci.nsIArray).enumerate();
          while (values.hasMoreElements()) {
            let value = values.getNext().QueryInterface(Ci.nsIPropertyBag2);
            this.addMetadatum(messageID, field.name, value.get(field.name));
          }
        }
      }

      else
        this.addMetadatum(messageID, field.name, field.value);
    }

    return messageID;
  },

  /**
   * Convert a string to an array of character codes.
   *
   * @param string {string} the string to convert
   * @returns {array} the array of character codes
   */
  stringToArray: function(string) {
    var array = [];
    for (let i = 0; i < string.length; i++)
      array.push(string.charCodeAt(i));
    return array;
  },

  /**
   * Given an entry, generate an ID for it based on a hash of its link,
   * published, and title attributes.  Useful for uniquely identifying entries
   * that don't provide their own IDs.
   *
   * @param entry {nsIFeedEntry} the entry for which to generate an ID
   * @returns {string} an ID for the entry
   */
  generateID: function(entry) {
    let hasher = Cc["@mozilla.org/security/hash;1"].
                 createInstance(Ci.nsICryptoHash);
    hasher.init(Ci.nsICryptoHash.SHA1);
    let identity = this.stringToArray(entry.link.spec + entry.published + entry.title.text);
    hasher.update(identity, identity.length);
    return "urn:" + hasher.finish(true);
  },

  // FIXME: Make the rest of this stuff be part of a superclass from which
  // this class is derived.

  /**
   * Get the internal ID of the message with the given external ID.
   *
   * @param    aExternalID {string}
   *           the external ID of the message
   *
   * @returns  {number}
   *           the internal ID of the message, or undefined if the message
   *           doesn't exist
   */
  getInternalIDForExternalID: function(aExternalID) {
    return SnowlDatastore.selectInternalIDForExternalID(aExternalID);
  },

  /**
   * Add a message with a single part to the datastore.
   *
   * @param aSourceID    {integer} the record ID of the message source
   * @param aExternalID  {string}  the external ID of the message
   * @param aSubject     {string}  the title of the message
   * @param aAuthor      {string}  the author of the message
   * @param aTimestamp   {Date}    the date/time at which the message was sent
   * @param aLink        {nsIURI}  a link to the content of the message,
   *                               if the content is hosted on a server
   *
   * @returns {integer} the internal ID of the newly-created message
   */
  addSimpleMessage: function(aSourceID, aExternalID, aSubject, aAuthor,
                             aTimestamp, aLink) {
    // Convert the timestamp to milliseconds-since-epoch, which is how we store
    // it in the datastore.
    let timestamp = aTimestamp ? aTimestamp.getTime() : null;

    // Convert the link to its string spec, which is how we store it
    // in the datastore.
    let link = aLink ? aLink.spec : null;

    let messageID =
      SnowlDatastore.insertMessage(aSourceID, aExternalID, aSubject, aAuthor,
                                   timestamp, link);

    return messageID;
  },

  get _addPartStatement() {
    let statement = SnowlDatastore.createStatement(
      "INSERT INTO parts(messageID, partType, content, baseURI, languageCode, mediaType) \
       VALUES (:messageID, :partType, :content, :baseURI, :languageCode, :mediaType)"
    );
    this.__defineGetter__("_addPartStatement", function() { return statement });
    return this._addPartStatement;
  },

  addPart: function(aMessageID, aPartType, aContent, aBaseURI, aLanguageCode,
                    aMediaType) {
    this._addPartStatement.params.messageID = aMessageID;
    this._addPartStatement.params.partType = aPartType;
    this._addPartStatement.params.content = aContent;
    this._addPartStatement.params.baseURI = aBaseURI;
    this._addPartStatement.params.languageCode = aLanguageCode;
    this._addPartStatement.params.mediaType = aMediaType;
    this._addPartStatement.execute();

    return SnowlDatastore.dbConnection.lastInsertRowID;
  },

  addMetadatum: function(aMessageID, aAttributeName, aValue) {
    // FIXME: speed this up by caching the list of known attributes.
    let attributeID = SnowlDatastore.selectAttributeID(aAttributeName)
                      || SnowlDatastore.insertAttribute(aAttributeName);
    SnowlDatastore.insertMetadatum(aMessageID, attributeID, aValue);
  },

  /**
   * Reset the last refreshed time for the given source to the current time.
   *
   * XXX should this be setLastRefreshed and take a time parameter
   * to set the last refreshed time to?
   *
   * aSource {SnowlMessageSource} the source for which to set the time
   */
  resetLastRefreshed: function() {
    let stmt = SnowlDatastore.createStatement("UPDATE sources SET lastRefreshed = :lastRefreshed WHERE id = :id");
    stmt.params.lastRefreshed = new Date().getTime();
    stmt.params.id = this.id;
    stmt.execute();
  }

};

// XXX Should we make this part of the Feed object?
// FIXME: make this accept a callback to which it reports on its progress
// so we can provide feedback to the user in subscription interfaces.
function SnowlFeedSubscriber(aURI, aName) {
  this.uri = aURI;
  this.name = aName;
}

SnowlFeedSubscriber.prototype = {
  uri: null,
  name: null,

  // Observer Service
  get _obsSvc() {
    let obsSvc = Cc["@mozilla.org/observer-service;1"].
                 getService(Ci.nsIObserverService);
    this.__defineGetter__("_obsSvc", function() { return obsSvc });
    return this._obsSvc;
  },

  QueryInterface: function(aIID) {
    if (aIID.equals(Ci.nsIDOMEventListener) ||
        aIID.equals(Ci.nsIFeedResultListener) ||
        aIID.equals(Ci.nsISupports))
      return this;

    throw Cr.NS_ERROR_NO_INTERFACE;
  },

  subscribe: function() {
    let request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance();

    request = request.QueryInterface(Ci.nsIDOMEventTarget);
    request.addEventListener("load", this, false);
    request.addEventListener("error", this, false);

    request = request.QueryInterface(Ci.nsIXMLHttpRequest);

    // The feed processor is going to parse the XML, so set the MIME type
    // in order to turn off parsing by XMLHttpRequest itself.
    request.overrideMimeType("text/plain");

    request.open("GET", this.uri.spec, true);
    request.send(null);
  },

  // nsIDOMEventListener

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

  onError: function(aEvent) {
dump("XMLHTTPRequest.onError for " + this.name + " <" + this.uri.spec + ">: " + aEvent.target.status + " " + aEvent.target.statusText + " " + aEvent.target.responseText.length + "\n");
  },

  onLoad: function(aEvent) {
    let request = aEvent.target;

    // FIXME: notify the user about the problem.
    if (request.responseText.length == 0)
      throw("feed contains no data");

    let parser = Cc["@mozilla.org/feed-processor;1"].
                 createInstance(Ci.nsIFeedProcessor);
    parser.listener = this;
    parser.parseFromString(request.responseText, request.channel.URI);
  },

  // nsIFeedResultListener

  handleResult: function(aResult) {
    let feed = aResult.doc.QueryInterface(Components.interfaces.nsIFeed);

    // Subscribe to the feed.
    let name = this.name || feed.title.plainText();
    let statement = SnowlDatastore.createStatement("INSERT INTO sources (name, machineURI, humanURI) VALUES (:name, :machineURI, :humanURI)");
    statement.params.name = name;
    statement.params.machineURI = this.uri.spec;
    statement.params.humanURI = feed.link.spec;
    //dump("subscribing to " + name + " <" + this.uri.spec + ">\n");
    statement.step();

    let id = SnowlDatastore.dbConnection.lastInsertRowID;

    // Now refresh the feed to import all its items.
    //dump("refreshing " + this.uri.spec + "\n");
    let feed2 = new SnowlFeed(id, this.uri.spec, name);
    feed2.handleResult(aResult);

    this._obsSvc.notifyObservers(null, "sources:changed", null);
    this._obsSvc.notifyObservers(null, "messages:changed", null);
  }

};
