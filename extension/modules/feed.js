EXPORTED_SYMBOLS = ["SnowlFeed"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/datastore.js");

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

// XXX: rename this SnowlFeedSource?
// XXX: make this inherit from a SnowlMessageSource interface?

function SnowlFeed(aID, aURL, aTitle) {
  this.id = aID;
  this.url = aURL;
  this.title = aTitle;

  this._log = Log4Moz.Service.getLogger("Snowl.Feed");
}

SnowlFeed.prototype = {
  id: null,
  url: null,
  title: null,

  _log: null,

/*
  _uri: null,
  get uri() {
    return this._uri;
  },

  get id() {
    var id = Snowl.datastore.selectSourceID(this.uri.spec);
    if (!id)
      return null;
    // We have an ID, and it won't change over the life of this object,
    // so memoize it for performance.
    this.__defineGetter__("id", function() { return id });
    return this.id;
  },
*/

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
        let universalID;
        try {
          universalID = entry.id || this.generateID(entry);
        }
        catch(ex) {
          this._log.warn(this.title + " couldn't retrieve a message: " + ex);
          continue;
        }

        let internalID = this.getInternalIDForExternalID(universalID);

        if (internalID)
          this._log.info(this.title + " has message " + universalID);
        else {
          this._log.info(this.title + " adding message " + universalID);
          internalID = this.addMessage(entry, universalID);
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

  // nsIFeedTextConstruct::type to MIME media type mappings.
  contentTypes: { html: "text/html", xhtml: "application/xhtml+xml", text: "text/plain" },

  getNewMessages: function() {
    let request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance();

    request.QueryInterface(Ci.nsIDOMEventTarget);
    // FIXME: just pass "this" and make this implement nsIDOMEventListener.
    let t = this;
    request.addEventListener("load", function(aEvent) { t.onLoad(aEvent) }, false);
    request.addEventListener("error", function(aEvent) { t.onError(aEvent) }, false);

    request.QueryInterface(Ci.nsIXMLHttpRequest);
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
   * @param aUniversalID  {string}        the universal ID of the feed entry
   */
  addMessage: function(aEntry, aUniversalID) {
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

    // Convert the content type specified by nsIFeedTextConstruct, which is
    // either "html", "xhtml", or "text", into an Internet media type.
    let contentType = aEntry.content ? this.contentTypes[aEntry.content.type] : null;
    let contentText = aEntry.content ? aEntry.content.text : null;
    let messageID = this.addSimpleMessage(this.id, aUniversalID,
                                                  aEntry.title.text, author,
                                                  timestamp, aEntry.link,
                                                  contentText, contentType);

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
