/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Snowl.
 *
 * The Initial Developer of the Original Code is Mozilla.
 * Portions created by the Initial Developer are Copyright (C) 2008
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Myk Melez <myk@mozilla.org>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

let EXPORTED_SYMBOLS = ["SnowlFeed"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

// modules that come with Firefox
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/ISO8601DateUtils.jsm");

// modules that are generic
Cu.import("resource://snowl/modules/Mixins.js");
Cu.import("resource://snowl/modules/Observers.js");
Cu.import("resource://snowl/modules/request.js");
Cu.import("resource://snowl/modules/URI.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/constants.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/source.js");
Cu.import("resource://snowl/modules/identity.js");
Cu.import("resource://snowl/modules/message.js");
Cu.import("resource://snowl/modules/utils.js");
Cu.import("resource://snowl/modules/service.js");

// FIXME: make strands.js into a module.
let loader = Cc["@mozilla.org/moz/jssubscript-loader;1"].getService(Ci.mozIJSSubScriptLoader);
loader.loadSubScript("chrome://snowl/content/strands.js");

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

function SnowlFeed(aID, aName, aMachineURI, aHumanURI, aUsername,
                   aLastRefreshed, aImportance, aPlaceID, aAttributes) {
  this.init(aID, aName, aMachineURI, aHumanURI, aUsername,
            aLastRefreshed, aImportance, aPlaceID, aAttributes);
}

SnowlFeed.prototype = {
  // The constructor property is defined automatically, but we destroy it
  // when we redefine the prototype, so we redefine it here in case we ever
  // need to check it to find out what kind of object an instance is.
  constructor: SnowlFeed,

  get _logName() {
    return "Snowl.Feed " + (this.name ? this.name : "<new feed>");
  },

  // If we prompt the user to authenticate, and the user asks us to remember
  // their password, we store the nsIAuthInformation in this property until
  // the request succeeds, at which point we store it with the login manager.
  _authInfo: null,

  // The nsIFeedResult object generated in the last refresh.
  // This can be used to get interesting info about the feed, like its type:
  //   this.lastResult.doc.QueryInterface(Ci.nsIFeed).type
  lastResult: null,


  //**************************************************************************//
  // Abstract Class Composition Declarations

  _classes: [SnowlSource],

  implements: function(cls) {
    return (this._classes.indexOf(cls) != -1);
  },


  //**************************************************************************//
  // SnowlSource

  // The default attributes for this source type.  Documentation in source.js.
  attributes: {
    refresh: {
      interval: 1000 * 60 * 30
    }
  },


  //**************************************************************************//
  // XPCOM Interface Goo

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

  asyncPromptAuth: function(channel, callback, context, level, authInfo) {
    this._log.debug("asyncPromptAuth: this.name = " + this.name + "; this.username = " + this.username);
    this._log.debug("asyncPromptAuth: this.name = " + this.name + "; authInfo.realm = " + authInfo.realm);
  
    let cancelable = {
      cancel: function() {
        if (win)
          win.QueryInterface(Ci.nsIDOMWindowInternal).close();
        callback.onAuthCancelled(context, false);
      }
    };
  
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

      let timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
      let timerCallback = {
        notify: function(timer) {
          callback.onAuthAvailable(context, authInfo);
        }
      }
      timer.initWithCallback(timerCallback, 0, Ci.nsITimer.TYPE_ONE_SHOT);

      return cancelable;
    }

    // If we've made it this far, none of the saved logins worked, so we prompt
    // the user to provide one.
  
    let args = Cc["@mozilla.org/supports-array;1"].createInstance(Ci.nsISupportsArray);
    args.AppendElement({ wrappedJSObject: this });
    args.AppendElement(authInfo);
  
    let t = this;
    let okCallback = function(remember) {
      if (remember)
        t._authInfo = authInfo;
      else
        t._authInfo = null;
      callback.onAuthAvailable(context, authInfo);
    }
    args.AppendElement({ wrappedJSObject: okCallback });
  
    let cancelCallback = function() {
      t._authInfo = null;
      callback.onAuthCancelled(context, true);
    }
    args.AppendElement({ wrappedJSObject: cancelCallback });
  
    let ww = Cc["@mozilla.org/embedcomp/window-watcher;1"].getService(Ci.nsIWindowWatcher);
    let win = ww.openWindow(null,
                            "chrome://snowl/content/login-async.xul",
                            null,
                            "chrome,centerscreen,dialog",
                            args);

    return cancelable;
  },


  //**************************************************************************//
  // Refreshment

  /**
   * Refresh the feed, retrieving the latest information in it.
   *
   * @param time        {Date}      [optional]
   *        when the refresh occurs; determines the received time of new
   *        messages; we let the caller specify this so a caller refreshing
   *        multiple feeds can give their messages the same received time
   */
  refresh: function(time) {
    this._log.trace("start refresh");

    if (typeof time == "undefined" || time == null)
      time = new Date();

    Observers.notify("snowl:refresh:connect:start", this);

    let request = new Request({
      // The feed processor is going to parse the response, so we override
      // the MIME type in order to turn off parsing by XMLHttpRequest itself.
      // XXX: overrideMimeType removed, find mimetype that does not encode..
//      overrideMimeType:       "text/plain",
      url:                    this.machineURI,
      // Listen for notification callbacks so we can handle authentication.
      notificationCallbacks:  this
    });
    this._log.info("refresh request finished, status: " + request.status);

    Observers.notify("snowl:refresh:connect:end", this, request.status);

    this.attributes.refresh["code"] = request.status;
    this.attributes.refresh["text"] = request.status + " (" + request.statusText + ")";
    if (request.status < 200 || request.status > 299 || request.responseText.length == 0) {
      this._log.trace("refresh request failed");
      this.onRefreshError();
      return;
    }
    this._log.trace("refresh request succeeded");

    // _authInfo only gets set if we prompted the user to authenticate
    // and the user checked the "remember password" box.  Since we're here,
    // it means the request succeeded, so we save the login.
    if (this._authInfo)
      this._saveLogin();

    Observers.notify("snowl:refresh:get:start", this);

    // Parse the response.
    // Note: this happens synchronously, even though it uses a listener
    // callback, which makes it look like it happens asynchronously.
    this._log.trace("parsing refresh response");
    let parser = Cc["@mozilla.org/feed-processor;1"].
                 createInstance(Ci.nsIFeedProcessor);
    parser.listener = {
      _self: this,
      _refreshTime: time,
      handleResult: function(result) {
        this._self.onRefreshResult(result, this._refreshTime);
      }
    };
    parser.parseFromString(request.responseText, request.channel.URI);

    this.lastRefreshed = time;

    this._log.trace("end refresh");
  },

  /**
   * Handle the result of the feed processor parsing the feed.
   *
   * @param result  {nsIFeedResult} the result
   * @param time    {Date}          the refresh timestamp
   */
  onRefreshResult: function(result, time) {
    this.lastResult = result;

    // result.doc is null when the processor failed to parse the feed.
    // Note that it is possible to enter an invalid domain or url, but due to
    // isps often returning a valid page, the only result will be a null doc.
    // FIXME: report a more descriptive error message and figure out a better
    // way to handle this condition.
    if (result.doc == null) {
      this.attributes.refresh["text"] = "result.doc is null, no valid feed found at this url";
      this.onRefreshError();
      return;
    }

    let feed = result.doc.QueryInterface(Ci.nsIFeed);

    // Extract the name and human URI (if we don't already have them)
    // from the feed.
    // ??? Should we update these if they've changed?
    if (!this.name)
      this.name = feed.title.plainText();
    // We don't use, persist, or restore subtitle, but FeedWriter uses it
    // when subscribing to a feed in a local application, so we set it here
    // so it's available for that purpose.
    // ??? Should we also persist and restore it?
    if (feed.subtitle)
      this.subtitle = feed.subtitle.plainText();
    if (!this.humanURI)
      this.humanURI = feed.link;

    this.messages = this._processFeed(feed, time);

    Observers.notify("snowl:refresh:get:end", this);
  },


  //**************************************************************************//
  // Processing

  /**
   * Process a feed into an array of messages.
   *
   * @param feed        {nsIFeed}       the feed
   * @param received    {Date}          when the messages were received
   */
  _processFeed: function(feed, received) {
    let messages = [];

    // Check fields properties from nsIFeed.
    let fields = feed.QueryInterface(Ci.nsIFeedContainer).
                 fields.QueryInterface(Ci.nsIPropertyBag2).enumerator;
    while (fields.hasMoreElements()) {
      let field = fields.getNext().QueryInterface(Ci.nsIProperty);
      // A bit loose here, perhaps create a language tags table.
      if (field.name.match(/lang/g))
        this.feedLanguage = field.name + ": " + field.value;
    }

    for (let i = 0; i < feed.items.length; i++) {
      let entry = feed.items.queryElementAt(i, Ci.nsIFeedEntry);

      // Figure out the ID for the entry, then check if the entry has already
      // been retrieved.  If the entry doesn't provide its own ID, we generate
      // one for it based on its content.
      let externalID;
      try {
        externalID = entry.id || this._generateID(entry);
        let message = this._processEntry(feed, entry, externalID, received);
        messages.push(message);
      }
      catch(ex) {
        this._log.error("couldn't process message " + externalID + ": " + ex);
      }
    }

    return messages;
  },

  /**
   * Process a feed entry into a message.
   *
   * @param aFeed         {nsIFeed}       the feed
   * @param aEntry        {nsIFeedEntry}  the entry
   * @param aExternalID   {string}        the external ID of the entry
   * @param aReceived     {Date}          when the message was received
   */
  _processEntry: function(aFeed, aEntry, aExternalID, aReceived) {
    let message = new SnowlMessage();

    message.source = this;
    message.externalID = aExternalID;
    message.subject = aEntry.title.text == null ? "" : aEntry.title.text;
    message.timestamp = aEntry.updated   ? new Date(SnowlDateUtils.RFC822Date(aEntry.updated))
                      : aEntry.published ? new Date(SnowlDateUtils.RFC822Date(aEntry.published))
                      : null;
    if (!message.timestamp && aEntry.fields.get("dc:date")) {
      // This date routine throws for really invalid dates.
      try { message.timestamp = ISO8601DateUtils.parse(aEntry.fields.get("dc:date")) }
      catch(ex) { message.timestamp = null; }
    }
    message.received = aReceived;
    message.link = aEntry.link;

    let authorID = null;
    let authors = (aEntry.authors.length > 0) ? aEntry.authors
                  : (aFeed.authors.length > 0) ? aFeed.authors
                  : null;
    // FIXME: process all authors, not just the first one.
    if (authors && authors.length > 0) {
      let author = authors.queryElementAt(0, Ci.nsIFeedPerson);
      // The external ID for an author is her email address, if provided
      // (many feeds don't); otherwise it's her name.  For the name, on the
      // other hand, we use the name, if provided, but fall back to the
      // email address if a name is not provided (which it probably was).
      let externalID = author.email || author.name;
      let name = author.name || author.email;
      message.author = new SnowlIdentity(null, this.id, externalID);
      message.author.person = new SnowlPerson(null, name, null, null, null);
      //identity = SnowlIdentity.get(this.id, externalID) ||
      //           SnowlIdentity.create(this.id, externalID, name);
    }

    // Add parts
    if (aEntry.content) {
      message.content =
        new SnowlMessagePart({
          partType:    PART_TYPE_CONTENT,
          content:     aEntry.content.text,
          mediaType:   INTERNET_MEDIA_TYPES[aEntry.content.type],
          baseURI:     aEntry.content.base,
          languageTag: aEntry.content.lang
        });
    }
    if (aEntry.summary) {
      message.summary =
        new SnowlMessagePart({
          partType:    PART_TYPE_SUMMARY,
          content:     aEntry.summary.text,
          mediaType:   INTERNET_MEDIA_TYPES[aEntry.summary.type],
          baseURI:     aEntry.summary.base,
          languageTag: aEntry.summary.lang
        });
    }

    // Add headers.
    message.headers = {};

    // Add fields properties from nsIFeedContainer.
    let hasLanguage = false;
    let hasMediacontent = false;
    let fields = aEntry.QueryInterface(Ci.nsIFeedContainer).
                 fields.QueryInterface(Ci.nsIPropertyBag).enumerator;

    while (fields.hasMoreElements()) {
      let field = fields.getNext().QueryInterface(Ci.nsIProperty);
//this._log.info("_processEntry: field.name - " + field.name);

      // FIXME: create people records for these.
      if (field.name == "authors") {
        let count = 1;
        // Note that the Fx feed processor normalizes author-like tags into
        // authors fields, so the original tag is lost; the processor also
        // formats rss author values (may have email in the string) into an
        // atom structure.
        let authStr = this.lastResult.version.match(/^atom/) ? "atom:author" :
                                                               "atom:author";

        let values = field.value.QueryInterface(Ci.nsIArray).enumerate();
        while (values.hasMoreElements()) {
          let value = values.getNext().QueryInterface(Ci.nsIFeedPerson);
          count = count == 1 ? "" : count;
          // FIXME: store people records in a separate table with individual
          // columns for each person attribute (i.e. name, email, url)?
          if (value.name)
            message.headers[authStr + count + "_name"] = value.name;
          if (value.email)
            message.headers[authStr + count + "_email"] = value.email;
          if (value.uri && value.uri.spec)
            message.headers[authStr + count + "_url"] = value.uri.spec;
          count++;
        }
      }

      else if (field.name == "links") {
        let count = 1;
        let values = field.value.QueryInterface(Ci.nsIArray).enumerate();
        while (values.hasMoreElements()) {
          let properties = values.getNext().
                                  QueryInterface(Ci.nsIPropertyBag2).enumerator;
          while (properties.hasMoreElements()) {
            let property = properties.getNext().QueryInterface(Ci.nsIProperty);
            let propertyName = property.name.replace(/^null/, "");
            message.headers["atom:link" + count + "_" + propertyName] = property.value;
          }
          count++;
        }
      }

      else if (field.name == "categories") {
        // Bug 493175: An atom 'category' doesn't seem to be added to the
        // 'categories' field array, and the individual 'category' value is empty.
        let count = 1;
        let values = field.value.QueryInterface(Ci.nsIArray).enumerate();
        while (values.hasMoreElements()) {
          let properties = values.getNext().
                                  QueryInterface(Ci.nsIPropertyBag2).enumerator;
          while (properties.hasMoreElements()) {
            let property = properties.getNext().
                                      QueryInterface(Ci.nsIProperty);
            // Bug 525655: namespace issue; 'prefix:tag' returned as 'nulltag'
            // if namespace/prefix pair not tabled.
            let propertyName = property.name.replace(/^null/, "");
            if (this.lastResult.version.match(/^atom/))
              message.headers["atom:category" + count + "_" + propertyName] = property.value;
            else
              // Unmassage nsIFeedEntry forcing of rss category into atom 'term'
              // property structure.
              if (property.name == "term")
                message.headers["category" + count] = property.value;
              else
                message.headers["category" + count + "_" + propertyName] = property.value;
          }
          count++;
        }
      }

      else if (field.name == "enclosure") {
        // The fields property 'enclosure' is an nsIPropertyBag2.  Any instances
        // of an enclosure tag are also found in nsIFeedEntry 'enclosures', which
        // is an nsIArray of nsIPropertyBag2.  Let 'enclosures' processing handle
        // for better numbering of multiple 'enclosure' items.
        continue;
      }

      else if (field.name == "mediacontent") {
        // The fields property 'mediacontent' is an nsIArray of nsIPropertyBag2.
        // Any instances of a media:content tag are also found in nsIFeedEntry
        // 'enclosures', which is an nsIArray of nsIPropertyBag2.
        hasMediacontent = true;
        continue;
      }

      else if (field.name == "mediagroup") {
        // The fields property 'mediagroup' is an nsIPropertyBag2 containing an
        // nsIArray of mediacontent nsIPropertyBag2.  Any instances of the 
        // media:content tags are also found in nsIFeedEntry 'enclosures', which
        // is an nsIArray of nsIPropertyBag2.
        // XXX: handle this in the headers.
        continue;
      }

      // For some reason, the values of certain simple fields (like RSS2 guid)
      // are property bags containing the value instead of the value itself.
      // For those, we need to unwrap the extra layer. This strange behavior
      // has been filed as bug 427907.
      // Follow up: the guid tag can contain a child tag 'isPermaLink'.  But
      // the whole nsIFeed and nsIFeedEntry structure is waay too complex, it
      // would be nice if those interfaces returned JSON structures instead.
      else if (typeof field.value == "object") {
        if (field.value instanceof Ci.nsIPropertyBag2) {
          let value = field.value.
                            QueryInterface(Ci.nsIPropertyBag2).get(field.name);
          message.headers[field.name] = value;

          let properties = field.value.
                                 QueryInterface(Ci.nsIPropertyBag2).enumerator;
          while (properties.hasMoreElements()) {
            // Check for any additional field name properties; skip the already
            // added main field name/value.
            let property = properties.getNext().QueryInterface(Ci.nsIProperty);
            if (property.name != field.name) {
              let propertyName = property.name.replace(/^null/, "");
              message.headers[field.name + "_" + propertyName] = property.value;
            }
          }
        }
        else if (field.value instanceof Ci.nsIArray) {
          let values = field.value.QueryInterface(Ci.nsIArray).enumerate();
          while (values.hasMoreElements()) {
            let value = values.getNext();
            if (value instanceof Ci.nsIPropertyBag2) {
              value = value.QueryInterface(Ci.nsIPropertyBag2);
              message.headers[field.name] = value.get(field.name);
            }
          }
        }
      }

      else {
        // Field is just a simple value.
        let fieldName = field.name.replace(/^null/, "");
        message.headers[fieldName] = field.value.substring(0, 500) +
                                     (field.value.length > 500 ? " [...]" : "");

        // One last try to get a valid date..
        if (!message.timestamp && fieldName == "publicationDate")
          message.timestamp = new Date(SnowlDateUtils.RFC822Date(field.value));
      }

      if (field.name.match(/lang/g)) {
        // Use the entry's language field, otherwise use the feed's language.
        hasLanguage = true;
      }
    }

    // Add 'enclosures' property from nsIFeedEntry.  Note that mediacontent is
    // always null though it exists - indicate media:content if found above in
    // fields, not clean if feeds have mixed enclosure and media:content tags.
    let encStr = hasMediacontent ? "media:content" : "enclosure";
    for (let i = 0; aEntry.enclosures && i < aEntry.enclosures.length; i++ ) {
      let count = 1;
      let properties = aEntry.enclosures.
                              queryElementAt(i, Ci.nsIPropertyBag2).enumerator;
      while (properties.hasMoreElements()) {
        let property = properties.getNext().QueryInterface(Ci.nsIProperty);
        let propertyName = property.name.replace(/^null/, "");
        message.headers[encStr + count + "_" + propertyName] = property.value;
      }
      count++;
    }

    if (aFeed.type)
      message.headers["feed_type"] = aFeed.type;
    if (!hasLanguage && this.feedLanguage)
      message.headers["feed_language_tag"] = this.feedLanguage;
    message.headers["feed_version"] = this.lastResult.version;

    return message;
  },

  /**
   * Given an entry, generate an ID for it based on a hash of its link,
   * published, and title attributes.  Useful for uniquely identifying entries
   * that don't provide their own IDs.
   * XXX Push this into SnowlMessage?
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

Mixins.meld(SnowlSource.prototype.attributes, true, false, SnowlService._log).
       into(SnowlFeed.prototype.attributes);
Mixins.mix(SnowlSource).into(SnowlFeed);
Mixins.mix(SnowlSource.prototype).into(SnowlFeed.prototype);
SnowlService.addAccountType(SnowlFeed, SnowlFeed.prototype.attributes);
