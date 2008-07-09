EXPORTED_SYMBOLS = ["SnowlFeed"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

// modules that come with Firefox
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/ISO8601DateUtils.jsm");

// modules that should come with Firefox
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/Observers.js");
Cu.import("resource://snowl/modules/URI.js");

// Snowl-specific modules
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/source.js");

// FIXME: factor this out into a common file.
const PART_TYPE_CONTENT = 1;
const PART_TYPE_SUMMARY = 2;

// nsIFeedTextConstruct::type to media type mappings.
const mediaTypes = { html: "text/html",
                     xhtml: "application/xhtml+xml",
                     text: "text/plain" };

/**
 * Convert a string to an array of character codes.
 *
 * @param string {string} the string to convert
 * @returns {array} the array of character codes
 */
function stringToArray(string) {
  var array = [];
  for (let i = 0; i < string.length; i++)
    array.push(string.charCodeAt(i));
  return array;
}

function SnowlFeed(aID, aName, aMachineURI, aHumanURI, aLastRefreshed, aImportance) {
  // Call the superclass's constructor to initialize the new instance.
  SnowlSource.call(this, aID, aName, aMachineURI, aHumanURI, aLastRefreshed, aImportance);
}

SnowlFeed.prototype = {
  __proto__: SnowlSource.prototype,

  _log: Log4Moz.Service.getLogger("Snowl.Feed"),

  // If we prompt the user to authenticate, and the user asks us to remember
  // their password, we store the nsIAuthInformation in this property until
  // the request succeeds, at which point we store it with the login manager.
  _authInfo: null,

  // Observer Service
  get _obsSvc() {
    let obsSvc = Cc["@mozilla.org/observer-service;1"].
                 getService(Ci.nsIObserverService);
    this.__defineGetter__("_obsSvc", function() { return obsSvc });
    return this._obsSvc;
  },

  // nsISupports

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIAuthPrompt2]),

  // nsIInterfaceRequestor

  getInterface: function(iid) {
    return this.QueryInterface(iid);
  },

  // nsIAuthPrompt2

  _logins: null,
  _loginIndex: 0,

  promptAuth: function(channel, level, authInfo) {
    // Check saved logins before prompting the user.  We get them
    // from the login manager and try each in turn until one of them works
    // or we run out of them.
    if (!this._logins) {
      let lm = Cc["@mozilla.org/login-manager;1"].getService(Ci.nsILoginManager);
      // XXX Should we be using channel.URI.prePath in case the old URI
      // redirects us to a new one at a different hostname?
      this._logins = lm.findLogins({}, this.machineURI.prePath, null, authInfo.realm);
    }

    let login = this._logins[this._loginIndex];
    if (login) {
      authInfo.username = login.username;
      authInfo.password = login.password;
      ++this._loginIndex;
      return true;
    }

    // If we've made it this far, none of the saved logins worked, so we prompt
    // the user to provide one.
    let args = Cc["@mozilla.org/supports-array;1"].createInstance(Ci.nsISupportsArray);
    args.AppendElement({ wrappedJSObject: this });
    args.AppendElement(authInfo);

    // |result| is how the dialog passes information back to us.  It sets two
    // properties on the object: |proceed|, which we return from this function,
    // and which determines whether or not authentication can proceed using
    // the values entered by the user; and |remember|, which determines whether
    // or not we save the user's login with the login manager once the request
    // succeeds.
    let result = {};
    args.AppendElement({ wrappedJSObject: result });

    let ww = Cc["@mozilla.org/embedcomp/window-watcher;1"].getService(Ci.nsIWindowWatcher);
    ww.openWindow(null,
                  // XXX Should we use commonDialog.xul?
                  "chrome://snowl/content/login.xul",
                  null,
                  "chrome,centerscreen,dialog,modal",
                  args);

    if (result.remember)
      this._authInfo = authInfo;

    return result.proceed;
  },

  asyncPromptAuth: function() {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
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

    // Register a listener for notification callbacks so we handle authentication.
    request.channel.notificationCallbacks = this;

    request.send(null);
  },

  onRefreshLoad: function(aEvent) {
    let request = aEvent.target;

    // If the request failed, let the error handler handle it.
    // XXX Do we need this?  Don't such failures call the error handler directly?
    if (request.status < 200 || request.status > 299) {
      this.onRefreshError(aEvent);
      return;
    }

    // XXX What's the right way to handle this?
    if (request.responseText.length == 0) {
      this.onRefreshError(aEvent);
      return;
    }

    // _authInfo only gets set if we prompted the user to authenticate
    // and the user checked the "remember password" box.  Since we're here,
    // it means the request succeeded, so we save the login.
    if (this._authInfo)
      this._saveLogin();

    let parser = Cc["@mozilla.org/feed-processor;1"].
                 createInstance(Ci.nsIFeedProcessor);
    parser.listener = { t: this, handleResult: function(r) { this.t.onRefreshResult(r) } };
    parser.parseFromString(request.responseText, request.channel.URI);
  },

  onRefreshError: function(aEvent) {
    let request = aEvent.target;

    // Sometimes an attempt to retrieve status text throws NS_ERROR_NOT_AVAILABLE
    let statusText = "";
    try {
      statusText = request.statusText;
    }
    catch(ex) {}
    
    this._log.error("onRefreshError: " + request.status + " (" + statusText + ")");
  },

  onRefreshResult: function(aResult) {
    Observers.notify(this, "snowl:subscribe:get:start", null);

    // Now that we know we successfully downloaded the feed and obtained
    // a result from it, update the "last refreshed" timestamp.
    this.lastRefreshed = new Date();

    let feed = aResult.doc.QueryInterface(Components.interfaces.nsIFeed);

    let currentMessageIDs = [];
    let messagesChanged = false;

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
          externalID = entry.id || this._generateID(entry);
        }
        catch(ex) {
          this._log.warn("couldn't retrieve a message: " + ex);
          continue;
        }

        let internalID = this._getInternalIDForExternalID(externalID);
        if (internalID)
          continue;

        messagesChanged = true;
        this._log.info(this.name + " adding message " + externalID);
        internalID = this._addMessage(feed, entry, externalID);
        currentMessageIDs.push(internalID);
      }

      // Update the current flag.
      // XXX Should this affect whether or not messages have changed?
      SnowlDatastore.dbConnection.executeSimpleSQL("UPDATE messages SET current = 0 WHERE sourceID = " + this.id);
      SnowlDatastore.dbConnection.executeSimpleSQL("UPDATE messages SET current = 1 WHERE id IN (" + currentMessageIDs.join(", ") + ")");

      SnowlDatastore.dbConnection.commitTransaction();
    }
    catch(ex) {
      SnowlDatastore.dbConnection.rollbackTransaction();
      throw ex;
    }

    if (messagesChanged)
      this._obsSvc.notifyObservers(null, "messages:changed", null);

    Observers.notify(this, "snowl:subscribe:get:end", null);
  },

  /**
   * Add a message to the datastore for the given feed entry.
   *
   * @param aFeed         {nsIFeed}       the feed
   * @param aEntry        {nsIFeedEntry}  the entry
   * @param aExternalID   {string}        the external ID of the entry
   */
  _addMessage: function(aFeed, aEntry, aExternalID) {
    // Determine the author.
    let author = null;
    if (aEntry.authors.length > 0) {
      let firstAuthor = aEntry.authors.queryElementAt(0, Ci.nsIFeedPerson);
      if (firstAuthor.name)
        author = firstAuthor.name;
      else if (firstAuthor.email)
        author = firstAuthor.email;
    }
    if (!author && aFeed.authors.length > 0) {
      let firstAuthor = aFeed.authors.queryElementAt(0, Ci.nsIFeedPerson);
      if (firstAuthor.name)
        author = firstAuthor.name;
      else if (firstAuthor.email)
        author = firstAuthor.email;
    }
    if (!author && aFeed.title) {
      author = aFeed.title.plainText();
    }

    // Pick a timestamp, which is one of (by priority, high to low):
    // 1. when the entry was last updated;
    // 2. when the entry was published;
    // 3. the Dublin Core timestamp associated with the entry;
    // XXX Should we separately record when we added the entry so that the user
    // can sort in the "order received" and view "when received" separately from
    // "when published/updated"?
    let timestamp = aEntry.updated ? new Date(aEntry.updated) :
                    aEntry.published ? new Date(aEntry.published) :
                    ISO8601DateUtils.parse(aEntry.get("dc:date"));

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
          this._addMetadatum(messageID,
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
          this._addMetadatum(messageID,
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
          this._addMetadatum(messageID, field.name, value);
        }
        else if (field.value instanceof Ci.nsIArray) {
          let values = field.value.QueryInterface(Ci.nsIArray).enumerate();
          while (values.hasMoreElements()) {
            let value = values.getNext().QueryInterface(Ci.nsIPropertyBag2);
            this._addMetadatum(messageID, field.name, value.get(field.name));
          }
        }
      }

      else
        this._addMetadatum(messageID, field.name, field.value);
    }

    return messageID;
  },

  /**
   * Given an entry, generate an ID for it based on a hash of its link,
   * published, and title attributes.  Useful for uniquely identifying entries
   * that don't provide their own IDs.
   *
   * @param entry {nsIFeedEntry} the entry for which to generate an ID
   * @returns {string} an ID for the entry
   */
  _generateID: function(entry) {
    let hasher = Cc["@mozilla.org/security/hash;1"].
                 createInstance(Ci.nsICryptoHash);
    hasher.init(Ci.nsICryptoHash.SHA1);
    let identity = stringToArray(entry.link.spec + entry.published + entry.title.text);
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
  _getInternalIDForExternalID: function(aExternalID) {
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

  _addMetadatum: function(aMessageID, aAttributeName, aValue) {
    // FIXME: speed this up by caching the list of known attributes.
    let attributeID = SnowlDatastore.selectAttributeID(aAttributeName)
                      || SnowlDatastore.insertAttribute(aAttributeName);
    SnowlDatastore.insertMetadatum(aMessageID, attributeID, aValue);
  },

  subscribe: function(callback) {
    Observers.notify(this, "snowl:subscribe:connect:start", null);

    this._subscribeCallback = callback;

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

    // Register a listener for notification callbacks so we handle authentication.
    request.channel.notificationCallbacks = this;

    request.send(null);
  },

  onSubscribeLoad: function(aEvent) {
    let request = aEvent.target;

    // If the request failed, let the error handler handle it.
    // XXX Do we need this?  Don't such failures call the error handler directly?
    if (request.status < 200 || request.status > 299) {
      this.onSubscribeError(aEvent);
      return;
    }

    // XXX What's the right way to handle this?
    if (request.responseText.length == 0) {
      this.onRefreshError(aEvent);
      return;
    }

    Observers.notify(this, "snowl:subscribe:connect:end", request.status);

    // _authInfo only gets set if we prompted the user to authenticate
    // and the user checked the "remember password" box.  Since we're here,
    // it means the request succeeded, so we save the login.
    if (this._authInfo)
      this._saveLogin();

    let parser = Cc["@mozilla.org/feed-processor;1"].
                 createInstance(Ci.nsIFeedProcessor);
    parser.listener = { t: this, handleResult: function(r) { this.t.onSubscribeResult(r) } };
    parser.parseFromString(request.responseText, request.channel.URI);
  },

  onSubscribeError: function(aEvent) {
    let request = aEvent.target;
    this._log.error("onSubscribeError: " + request.status + " (" + request.statusText + ")");
    Observers.notify(this, "snowl:subscribe:connect:end", request.status);
    if (this._subscribeCallback)
      this._subscribeCallback();
  },

  onSubscribeResult: function(aResult) {
    try {
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
    catch(ex) {
      dump("error on subscribe result: " + ex + "\n");
    }
    finally {
      if (this._subscribeCallback)
        this._subscribeCallback();
    }
  },

  _saveLogin: function() {
    let lm = Cc["@mozilla.org/login-manager;1"].getService(Ci.nsILoginManager);

    // Create a new login with the auth information we obtained from the user.
    let LoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1",
                                               Ci.nsILoginInfo,
                                               "init");
    // XXX Should we be using channel.URI.prePath in case the old URI
    // redirects us to a new one at a different hostname?
    let newLogin = new LoginInfo(this.machineURI.prePath,
                                 null,
                                 this._authInfo.realm,
                                 this._authInfo.username,
                                 this._authInfo.password,
                                 "",
                                 "");

    // Get existing logins that have the same hostname and realm.
    let logins = lm.findLogins({}, this.machineURI.prePath, null, this._authInfo.realm);

    // Try to figure out if we should replace one of the existing logins.
    // If there's only one existing login, we replace it.  Otherwise, if
    // there's a login with the same username, we replace that.  Otherwise,
    // we add the new login instead of replacing an existing one.
    let oldLogin;
    if (logins.length == 1)
      oldLogin = logins[0];
    else if (logins.length > 1)
      oldLogin = logins.filter(function(v) v.username == this._authInfo.username)[0];

    if (oldLogin)
      lm.modifyLogin(oldLogin, newLogin);
    else
      lm.addLogin(newLogin);

    // Now that we've saved the login, we don't need the auth info anymore.
    this._authInfo = null;
  }

};
