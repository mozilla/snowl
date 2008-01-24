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
    dump("error loading feed " + aEvent.target.channel.originalURI + "\n");
  }
};

function SnowlFeed(aID, aURL, aTitle) {
  this.id = aID;
  this.url = aURL;
  this.title = aTitle;
}

SnowlFeed.prototype = {
  id: null,
  url: null,
  title: null,

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
    let feed = result.doc.QueryInterface(Components.interfaces.nsIFeed);

    for (let i = 0; i < feed.items.length; i++) {
      let entry = feed.items.queryElementAt(i, Ci.nsIFeedEntry);
      entry.QueryInterface(Ci.nsIFeedContainer);
      let universalID = entry.id || this.generateID(entry);

      if (Snowl.hasMessage(universalID))
{
dump(this.title + " already has message " + universalID + "\n");
        continue;
}

dump(this.title + " adding message " + universalID + "\n");
      this.addMessage(entry, universalID);
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
    dump("error loading feed " + aEvent.target.channel.originalURI + "\n");
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
    let messageID = Snowl.addSimpleMessage(this.id, aUniversalID, aEntry.title.text,
                                           author, timestamp, aEntry.link,
                                           aEntry.content.text, contentType);

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
          Snowl.addMetadatum(messageID,
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
          Snowl.addMetadatum(messageID,
                             "atom:link_" + value.get("rel"),
                             value.get("href"));
        }
      }
      else
        Snowl.addMetadatum(messageID, field.name, field.value);
    }

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
    let identity = stringToArray(entry.link + entry.published + entry.title.text);
    hasher.update(identity, identity.length);
    let id = "urn:" + hasher.finish(true);
  }
};
