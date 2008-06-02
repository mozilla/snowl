EXPORTED_SYMBOLS = ["SnowlFeed"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/URI.js");
Cu.import("resource://snowl/modules/source.js");

// FIXME: factor this out into a common file.
const PART_TYPE_CONTENT = 1;
const PART_TYPE_SUMMARY = 2;

// nsIFeedTextConstruct::type to media type mappings.
const mediaTypes = { html: "text/html",
                     xhtml: "application/xhtml+xml",
                     text: "text/plain" };

function SnowlFeed(aID, aName, aMachineURI, aHumanURI, aLastRefreshed, aImportance) {
  // Call the superclass's constructor to initialize the new instance.
  SnowlSource.call(this, aID, aName, aMachineURI, aHumanURI, aLastRefreshed, aImportance);
}

SnowlFeed.prototype = {
  __proto__: SnowlSource.prototype,

  _log: Log4Moz.Service.getLogger("Snowl.Feed"),

  // Observer Service
  get _obsSvc() {
    let obsSvc = Cc["@mozilla.org/observer-service;1"].
                 getService(Ci.nsIObserverService);
    this.__defineGetter__("_obsSvc", function() { return obsSvc });
    return this._obsSvc;
  },

  refresh: function() {
    let request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance();

    request.QueryInterface(Ci.nsIDOMEventTarget);
    let t = this;
    request.addEventListener("load", function(e) { t.onRefreshLoad(e) }, false);
    request.addEventListener("error", function(e) { t.onRefreshError(e) }, false);

    request.QueryInterface(Ci.nsIXMLHttpRequest);

    // The feed processor is going to parse the XML, so override the MIME type
    // in order to turn off parsing by XMLHttpRequest itself.
    request.overrideMimeType("text/plain");

    request.open("GET", this.machineURI.spec, true);
    request.send(null);
  },

  onRefreshLoad: function(aEvent) {
    let request = aEvent.target;

    // XXX What's the right way to handle this?
    if (request.responseText.length == 0)
      throw("feed contains no data");

    let parser = Cc["@mozilla.org/feed-processor;1"].
                 createInstance(Ci.nsIFeedProcessor);
    parser.listener = { t: this, handleResult: function(r) { this.t.onRefreshResult(r) } };
    parser.parseFromString(request.responseText, request.channel.URI);
  },

  onRefreshError: function(aEvent) {
    this._log.error("onRefreshError: " + aEvent.target.status + " " +
                    aEvent.target.statusText + " " + aEvent.target.responseText.length);
  },

  onRefreshResult: function(aResult) {
    // Now that we know we successfully downloaded the feed and obtained
    // a result from it, update the "last refreshed" timestamp.
    this.resetLastRefreshed(this);

    let feed = aResult.doc.QueryInterface(Components.interfaces.nsIFeed);

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
          this._log.warn(this.name + " couldn't retrieve a message: " + ex);
          continue;
        }

        let internalID = this.getInternalIDForExternalID(externalID);

        if (internalID) {
          //this._log.info(this.name + " has message " + externalID);
        }
        else {
          this._log.info(this.name + " adding message " + externalID);
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

    // FIXME: only do this if something has actually changed.
    this._obsSvc.notifyObservers(null, "messages:changed", null);
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
                   aEntry.content.lang, mediaTypes[aEntry.content.type]);
    }

    if (aEntry.summary) {
      this.addPart(messageID, PART_TYPE_SUMMARY, aEntry.summary.text,
                   (aEntry.summary.base ? aEntry.summary.base.spec : null),
                   aEntry.summary.lang, mediaTypes[aEntry.summary.type]);
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
  // FIXME: make this a setter for the lastRefreshed property.
  resetLastRefreshed: function() {
    let stmt = SnowlDatastore.createStatement("UPDATE sources SET lastRefreshed = :lastRefreshed WHERE id = :id");
    stmt.params.lastRefreshed = new Date().getTime();
    stmt.params.id = this.id;
    stmt.execute();
  },

  // FIXME: make this accept a callback to which it reports on its progress
  // so we can provide feedback to the user in subscription interfaces.
  subscribe: function() {
    this._log.info("subscribing to " + this.name + " <" + this.machineURI.spec + ">");

    let request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance();

    request = request.QueryInterface(Ci.nsIDOMEventTarget);

    let t = this;
    request.addEventListener("load", function(e) { t.onSubscribeLoad(e) }, false);
    request.addEventListener("error", function(e) { t.onSubscribeError(e) }, false);

    request = request.QueryInterface(Ci.nsIXMLHttpRequest);

    // The feed processor is going to parse the XML, so override the MIME type
    // in order to turn off parsing by XMLHttpRequest itself.
    request.overrideMimeType("text/plain");

    request.open("GET", this.machineURI.spec, true);
    request.send(null);
  },

  onSubscribeLoad: function(aEvent) {
    let request = aEvent.target;

    // XXX What's the right way to handle this?
    if (request.responseText.length == 0)
      throw("feed contains no data");

    let parser = Cc["@mozilla.org/feed-processor;1"].
                 createInstance(Ci.nsIFeedProcessor);
    parser.listener = { t: this, handleResult: function(r) { this.t.onSubscribeResult(r) } };
    parser.parseFromString(request.responseText, request.channel.URI);
  },

  onSubscribeError: function(aEvent) {
    this._log.error("onSubscribeError: " + aEvent.target.status + " " +
                    aEvent.target.statusText + " " + aEvent.target.responseText.length);
  },

  onSubscribeResult: function(aResult) {
    let feed = aResult.doc.QueryInterface(Components.interfaces.nsIFeed);

    // Extract the name (if we don't already have one) and human URI from the feed.
    if (!this.name)
      this.name = feed.title.plainText();
    this.humanURI = feed.link;

    // Add the source to the database.
    let statement =
      SnowlDatastore.createStatement("INSERT INTO sources (name, machineURI, humanURI) " +
                                     "VALUES (:name, :machineURI, :humanURI)");
    try {
      statement.params.name = this.name;
      statement.params.machineURI = this.machineURI.spec;
      statement.params.humanURI = this.humanURI.spec;
      statement.step();
    }
    finally {
      statement.reset();
    }

    // Extract the ID of the source from the newly-created database record.
    this.id = SnowlDatastore.dbConnection.lastInsertRowID;

    // Let observers know about the new source.
    this._obsSvc.notifyObservers(null, "sources:changed", null);

    // Refresh the feed to import all its items.
    this.onRefreshResult(aResult);
  }

};
