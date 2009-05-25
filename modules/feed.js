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
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/Mixin.js");
Cu.import("resource://snowl/modules/Observers.js");
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

function SnowlFeed(aID, aName, aMachineURI, aHumanURI, aUsername, aLastRefreshed, aImportance, aPlaceID) {
  SnowlSource.init.call(this, aID, aName, aMachineURI, aHumanURI, aUsername, aLastRefreshed, aImportance, aPlaceID);
}

SnowlFeed.prototype = {
  // The constructor property is defined automatically, but we destroy it
  // when we redefine the prototype, so we redefine it here in case we ever
  // need to check it to find out what kind of object an instance is.
  constructor: SnowlFeed,

  get _log() {
    let logger = Log4Moz.repository.getLogger("Snowl.Feed " + this.name);
    this.__defineGetter__("_log", function() logger);
    return this._log;
  },

  // If we prompt the user to authenticate, and the user asks us to remember
  // their password, we store the nsIAuthInformation in this property until
  // the request succeeds, at which point we store it with the login manager.
  _authInfo: null,


  //**************************************************************************//
  // Abstract Class Composition Declarations

  _classes: [SnowlSource],

  implements: function(cls) {
    return (this._classes.indexOf(cls) != -1);
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

  asyncPromptAuth: function() {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },

  _refreshTime: null,

  refresh: function(refreshTime) {
    // Cache the refresh time so we can use it as the received time when adding
    // messages to the datastore.
    this._refreshTime = refreshTime;

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

    // We set the last refreshed timestamp here even though the refresh
    // is asynchronous, so we don't yet know whether it has succeeded.
    // The upside of this approach is that we don't keep trying to refresh
    // a source that isn't responding, but the downside is that it takes
    // a long time for us to refresh a source that is only down for a short
    // period of time.  We should instead keep trying when a source fails,
    // but with a progressively longer interval (up to the standard one).
    // FIXME: implement the approach described above.
    this.lastRefreshed = refreshTime;
  },

  onRefreshLoad: function(aEvent) {
    let request = aEvent.target;

    // The load event can fire even with a non 2xx code, so handle as error
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

    // Use the built-in feed processor to parse the response synchronously
    // (but we process the result asynchronously using a coroutine).
    let parser = Cc["@mozilla.org/feed-processor;1"].
                 createInstance(Ci.nsIFeedProcessor);
    parser.listener = {
      self: this,
      handleResult: function(result) {
        this.self._processRefresh(result, this.self._refreshTime);
      }
    };
    parser.parseFromString(request.responseText, request.channel.URI);

    this._resetRefresh();
  },

  onRefreshError: function(aEvent) {
    let request = aEvent.target;

    // Sometimes an attempt to retrieve status text throws NS_ERROR_NOT_AVAILABLE.
    let statusText;
    try {statusText = request.statusText;} catch(ex) {statusText = "[no status text]"}

    this._log.error("onRefreshError: " + request.status + " (" + statusText + ")");

    this._resetRefresh();
  },

  _processRefresh: strand(function(aResult, refreshTime) {
    // FIXME: figure out why aResult.doc is sometimes null (its content isn't
    // a valid feed?) and report a more descriptive error message.
    if (aResult.doc == null) {
      this._log.error("_processRefresh: aResult.doc is null");
//      Observers.notify("snowl:subscribe:get:end", this);
      return;
    }

    // FIXME: Make this be "snowl:refresh:start" or move it into the subscribing
    // caller so it makes sense that it's called "snowl:subscribe:get:start",
    // since this method also gets called during periodically on feeds to which
    // the user is already subscribed.
    Observers.notify("snowl:subscribe:get:start", this);

    let feed = aResult.doc.QueryInterface(Components.interfaces.nsIFeed);

    let currentMessageIDs = [];
    let messagesChanged = false;

    // Sort the messages by date, so we insert them from oldest to newest,
    // which makes them show up in the correct order in views that expect
    // messages to be inserted in that order and sort messages by their IDs.
    let messages = [];
    for (let i = 0; i < feed.items.length; i++) {
      let entry = feed.items.queryElementAt(i, Ci.nsIFeedEntry);
      let timestamp =   entry.updated               ? new Date(entry.updated)
                      : entry.published             ? new Date(entry.published)
                      : entry.fields.get("dc:date") ? ISO8601DateUtils.parse(entry.fields.get("dc:date"))
                      : null;
      messages.push({ entry: entry, timestamp: timestamp });
    }
    messages.sort(function(a, b) a.timestamp < b.timestamp ? -1 :
                                 a.timestamp > b.timestamp ?  1 : 0);

    for each (let message in messages) {
      let entry = message.entry;

      // Figure out the ID for the entry, then check if the entry has already
      // been retrieved.  If the entry doesn't provide its own ID, we generate
      // one for it based on its content.
      let externalID;
      try {
        externalID = entry.id || this._generateID(entry);
      }
      catch(ex) {
        this._log.warn("couldn't get an ID for a message: " + ex);
        continue;
      }

      // Ignore the message if we've already added it.
      let internalID = this._getInternalIDForExternalID(externalID);
      if (internalID) {
        currentMessageIDs.push(internalID);
        continue;
      }

      // Add the message.
      messagesChanged = true;
      this._log.info("adding message " + externalID);
      internalID = this._addMessage(feed, entry, externalID, message.timestamp, refreshTime);
      currentMessageIDs.push(internalID);

      // Sleep for a bit to give other sources that are being refreshed
      // at the same time the opportunity to insert messages themselves,
      // so the messages appear mixed together in views that display messages
      // by the order in which they are received, which is more pleasing
      // than if the messages were clumped together by source.
      // As a side effect, this might reduce horkage of the UI thread
      // during refreshes.
      yield sleep(50);
    }

    // Update the current flag.
    this.updateCurrentMessages(currentMessageIDs);

    // Notify list and collections views on completion of messages download, list
    // also notified of each message addition.
    if (messagesChanged)
      Observers.notify("snowl:messages:changed", this.id);

    Observers.notify("snowl:subscribe:get:end", this);
  }),

  _resetRefresh: function() {
    this._refreshTime = null;
  },

  /**
   * Add a message to the datastore for the given feed entry.
   *
   * @param aFeed         {nsIFeed}       the feed
   * @param aEntry        {nsIFeedEntry}  the entry
   * @param aExternalID   {string}        the external ID of the entry
   * @param aTimestamp    {Date}          the message's timestamp
   * @param aReceived     {Date}          when the message was received
   */
  _addMessage: function(aFeed, aEntry, aExternalID, aTimestamp, aReceived) {
    let messageID;

    SnowlDatastore.dbConnection.beginTransaction();
    try {
      let authorID = null;
      let authors = (aEntry.authors.length > 0) ? aEntry.authors
                    : (aFeed.authors.length > 0) ? aFeed.authors
                    : null;
      if (authors && authors.length > 0) {
        let author = authors.queryElementAt(0, Ci.nsIFeedPerson);
        // The external ID for an author is her email address, if provided
        // (many feeds don't); otherwise it's her name.  For the name, on the
        // other hand, we use the name, if provided, but fall back to the
        // email address if a name is not provided (which it probably was).
        let externalID = author.email || author.name;
        let name = author.name || author.email;

        // Get an existing identity or create a new one.  Creating an identity
        // automatically creates a person record with the provided name.
        identity = SnowlIdentity.get(this.id, externalID) ||
                   SnowlIdentity.create(this.id, externalID, name);
        authorID = identity.personID;
      }

      // FIXME: handle titles that contain markup or are missing.
      messageID = this.addSimpleMessage(this.id, aExternalID,
                                        aEntry.title.text, authorID,
                                        aTimestamp, aReceived, aEntry.link);

      // Add parts
      if (aEntry.content) {
        this.addPart(messageID,
                     aEntry.content.text,
                     INTERNET_MEDIA_TYPES[aEntry.content.type],
                     PART_TYPE_CONTENT,
                     aEntry.content.base,
                     aEntry.content.lang);
      }
      if (aEntry.summary) {
        this.addPart(messageID,
                     aEntry.summary.text,
                     INTERNET_MEDIA_TYPES[aEntry.summary.type],
                     PART_TYPE_SUMMARY,
                     aEntry.summary.base,
                     aEntry.summary.lang);
      }

      // Add metadata.
      let fields = aEntry.QueryInterface(Ci.nsIFeedContainer).
                   fields.QueryInterface(Ci.nsIPropertyBag).enumerator;
      while (fields.hasMoreElements()) {
        let field = fields.getNext().QueryInterface(Ci.nsIProperty);

        // FIXME: create people records for these.
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
              // FIXME: values might not always have this interface.
              let value = values.getNext().QueryInterface(Ci.nsIPropertyBag2);
              this._addMetadatum(messageID, field.name, value.get(field.name));
            }
          }
        }

        else
          this._addMetadatum(messageID, field.name, field.value);
      }

      SnowlDatastore.dbConnection.commitTransaction();
    }
    catch(ex) {
      SnowlDatastore.dbConnection.rollbackTransaction();
      this._log.error("couldn't add " + aExternalID + ": " + ex);
    }

    Observers.notify("snowl:message:added", SnowlMessage.get(messageID));

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


  //**************************************************************************//
  // Subscription

  _subscribeCallback: null,

  subscribe: function(callback) {
    Observers.notify("snowl:subscribe:connect:start", this);

    this._subscribeCallback = callback;

    this._log.info("subscribing to " + this.machineURI.spec);

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

    // The load event can fire even with a non 2xx code, so handle as error
    if (request.status < 200 || request.status > 299) {
      this.onSubscribeError(aEvent);
      return;
    }

    // XXX What's the right way to handle this?
    if (request.responseText.length == 0) {
      this.onRefreshError(aEvent);
      return;
    }

    Observers.notify("snowl:subscribe:connect:end", this, request.status);

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

    // Sometimes an attempt to retrieve status text throws NS_ERROR_NOT_AVAILABLE.
    let statusText;
    try {statusText = request.statusText;} catch(ex) {statusText = "[no status text]"}

    this._log.error("onSubscribeError: " + request.status + " (" + statusText + ")");
    Observers.notify("snowl:subscribe:connect:end", this, request.status);

    if (this._subscribeCallback)
      this._subscribeCallback();
  },

  onSubscribeResult: strand(function(aResult) {
    let feed;
    try {
      feed = aResult.doc.QueryInterface(Components.interfaces.nsIFeed);

      // Extract the name (if we don't already have one) and human URI from the feed.
      if (!this.name)
        this.name = feed.title.plainText();
      this.humanURI = feed.link;

      this.persist();

//      Observers.notify("snowl:sources:changed");

      // Refresh the feed to import all its items.
      // FIXME: use a date provided by the subscriber so refresh times are the same
      // for all accounts subscribed at the same time (f.e. in an OPML import).
      yield this._processRefresh(aResult, new Date());
    }
    catch(ex) {
      this._log.error("error on subscribe result: " + feed.toSource());
      this._log.error("error on subscribe result: " + ex);
      Observers.notify("snowl:subscribe:connect:end", this, "error:" + ex);
    }
    finally {
      if (this._subscribeCallback)
        this._subscribeCallback();
    }
  }),

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

inmix(SnowlFeed.prototype, SnowlSource);
SnowlService.addAccountType(SnowlFeed);
