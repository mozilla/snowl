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

let EXPORTED_SYMBOLS = ["SnowlTwitter"];

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
Cu.import("resource://snowl/modules/identity.js");

// FIXME: factor this out into a common file.
const PART_TYPE_CONTENT = 1;
const PART_TYPE_SUMMARY = 2;

const NAME = "Twitter";
const MACHINE_URI = URI.get("https://twitter.com");
// XXX Should this be simply http://twitter.com ?
const HUMAN_URI = URI.get("http://twitter.com/home");

function SnowlTwitter(aID, aLastRefreshed, aImportance) {
  // XXX Should we append the username to the NAME const to enable users
  // to subscribe to multiple Twitter accounts?

  // Call the superclass's constructor to initialize the new instance.
  SnowlSource.call(this, aID, NAME, MACHINE_URI, HUMAN_URI, aLastRefreshed, aImportance);
}

SnowlTwitter.prototype = {
  constructor: SnowlTwitter,

  __proto__: SnowlSource.prototype,

  _log: Log4Moz.Service.getLogger("Snowl.Twitter"),

  // Observer Service
  get _obsSvc() {
    let obsSvc = Cc["@mozilla.org/observer-service;1"].
                 getService(Ci.nsIObserverService);
    this.__defineGetter__("_obsSvc", function() { return obsSvc });
    return this._obsSvc;
  },


  //**************************************************************************//
  // Notification Callbacks for Authentication

  // FIXME: factor this out with the equivalent code in feed.js.

  // If we prompt the user to authenticate, and the user asks us to remember
  // their password, we store the nsIAuthInformation in this property until
  // the request succeeds, at which point we store it with the login manager.
  _authInfo: null,

  // Logins from the login manager that we try in turn until we run out of them
  // or one of them works.
  // XXX Should we only try the username the user entered when they originally
  // subscribed to the source?  After all, different usernames could result in
  // different content, and it might not be what the user expects.
  _logins: null,
  _loginIndex: 0,

  // nsISupports

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIAuthPrompt2]),

  // nsIInterfaceRequestor

  getInterface: function(iid) {
    return this.QueryInterface(iid);
  },

  // nsIAuthPrompt2

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


  //**************************************************************************//
  // Subscription

  subscribe: function(credentials) {
    Observers.notify(this, "snowl:subscribe:connect:start", null);

    let request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance();

    request.QueryInterface(Ci.nsIDOMEventTarget);
    let t = this;
    request.addEventListener("load", function(e) { t.onSubscribeLoad(e) }, false);
    request.addEventListener("error", function(e) { t.onSubscribeError(e) }, false);

    request.QueryInterface(Ci.nsIXMLHttpRequest);

    request.open("GET", this.machineURI.spec + "/account/verify_credentials.json", true);

    // We could just set the Authorization request header here, but then
    // we wouldn't get an nsIAuthInformation object through our notification
    // callbacks, so we'd have to parse the WWW-Authenticate header ourselves
    // to extract the realm to use when saving the credentials to the login
    // manager, and WWW-Authenticate header parsing is said to be tricky.

    // So instead we define notification callbacks that fill in (and persist)
    // an nsIAuthInformation object the first time they are called (subsequent
    // attempts fail, though, to avoid an infinite loop with a server that keeps
    // rejecting our credentials along with a Mozilla that keeps prompting
    // for them).
    request.channel.notificationCallbacks = {
      QueryInterface: XPCOMUtils.generateQI([Ci.nsIAuthPrompt2]),
      getInterface: function(iid) { return this.QueryInterface(iid) },
      _firstAttempt: true,
      promptAuth: function(channel, level, authInfo) {
        if (!this._firstAttempt) {
          if (credentials.remember)
            this._authInfo = null;
          return false;
        }
        authInfo.username = credentials.username;
        authInfo.password = credentials.password;
        if (credentials.remember)
          this._authInfo = authInfo;
        this._firstAttempt = false;
        return true;
      },
      asyncPromptAuth: function() { throw Cr.NS_ERROR_NOT_IMPLEMENTED }
    };

    request.send(null);
  },

  onSubscribeLoad: function(event) {
    let request = event.target;

    // request.responseText should be: {"authorized":true}
    this._log.info("onSubscribeLoad: " + request.responseText);

    // If the request failed, let the error handler handle it.
    // XXX Do we need this?  Don't such failures call the error handler directly?
    if (request.status < 200 || request.status > 299) {
      this.onSubscribeError(event);
      return;
    }

    // XXX What's the right way to handle this?
    if (request.responseText.length == 0) {
      this.onSubscribeError(event);
      return;
    }

    Observers.notify(this, "snowl:subscribe:connect:end", request.status);

    // _authInfo only gets set if we prompted the user to authenticate
    // and the user checked the "remember password" box.  Since we're here,
    // it means the request succeeded, so we save the login.
    if (this._authInfo)
      this._saveLogin();

    // Save the source to the database.
    this.persist();

    // Let observers know about the new source.
    this._obsSvc.notifyObservers(null, "sources:changed", null);

    this.refresh();
  },

  onSubscribeError: function(event) {
    let request = event.target;

    // request.responseText should be: Could not authenticate you.
    this._log.info("onSubscribeError: " + request.responseText);

    // Sometimes an attempt to retrieve status text throws NS_ERROR_NOT_AVAILABLE.
    let statusText = "";
    try {
      statusText = request.statusText;
    }
    catch(ex) {}
    
    this._log.error("onSubscribeError: " + request.status + " (" + statusText + ")");

    Observers.notify(this, "snowl:subscribe:connect:end", request.status);
  },


  //**************************************************************************//
  // Refreshment

  refresh: function() {
    Observers.notify(this, "snowl:subscribe:get:start", null);

    let request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance();

    request.QueryInterface(Ci.nsIDOMEventTarget);
    let t = this;
    request.addEventListener("load", function(e) { t.onRefreshLoad(e) }, false);
    request.addEventListener("error", function(e) { t.onRefreshError(e) }, false);

    request.QueryInterface(Ci.nsIXMLHttpRequest);

    // FIXME: use the count parameter to retrieve more messages at once.
    // FIXME: use the since or since_id parameter to retrieve only new messages.
    // http://groups.google.com/group/twitter-development-talk/web/api-documentation
    request.open("GET", this.machineURI.spec + "/statuses/friends_timeline.json", true);

    // Register a listener for notification callbacks so we handle authentication.
    request.channel.notificationCallbacks = this;

    request.send(null);
  },

  onRefreshLoad: function(event) {
    let request = event.target;

    // If the request failed, let the error handler handle it.
    // XXX Do we need this?  Don't such failures call the error handler directly?
    if (request.status < 200 || request.status > 299) {
      this.onRefreshError(event);
      return;
    }

    // XXX What's the right way to handle this?
    if (request.responseText.length == 0) {
      this.onRefreshError(event);
      return;
    }

    // _authInfo only gets set if we prompted the user to authenticate
    // and the user checked the "remember password" box.  Since we're here,
    // it means the request succeeded, so we save the login.
    if (this._authInfo)
      this._saveLogin();

    this._processRefresh(request.responseText);
  },

  onRefreshError: function(event) {
    let request = event.target;

    // Sometimes an attempt to retrieve status text throws NS_ERROR_NOT_AVAILABLE
    let statusText = "";
    try {
      statusText = request.statusText;
    }
    catch(ex) {}
    
    this._log.error("onRefreshError: " + request.status + " (" + statusText + ")");
  },

  _processRefresh: function(responseText) {
    // Now that we know we successfully downloaded the source and obtained
    // a result from it, update the "last refreshed" timestamp.
    this.lastRefreshed = new Date();

    var JSON = Cc["@mozilla.org/dom/json;1"].createInstance(Ci.nsIJSON);
    let messages = JSON.decode(responseText);

    let currentMessages = [];
    let messagesChanged = false;

    SnowlDatastore.dbConnection.beginTransaction();
    try {
      for each (let message in messages) {
        let externalID = message.id;
        let internalID = this._getInternalIDForExternalID(externalID);
        if (internalID) {
          currentMessages.push(internalID);
          continue;
        }

        messagesChanged = true;
        this._log.info(this.name + " adding message " + externalID);
        internalID = this._addMessage(message);
        currentMessages.push(internalID);
      }

      // Update the current flag.
      // XXX Should this affect whether or not messages have changed?
      SnowlDatastore.dbConnection.executeSimpleSQL("UPDATE messages SET current = 0 WHERE sourceID = " + this.id);
      SnowlDatastore.dbConnection.executeSimpleSQL("UPDATE messages SET current = 1 WHERE id IN (" + currentMessages.join(", ") + ")");

      SnowlDatastore.dbConnection.commitTransaction();
    }
    catch(ex) {
      SnowlDatastore.dbConnection.rollbackTransaction();
      throw ex;
    }

    if (messagesChanged)
      this._obsSvc.notifyObservers(null, "messages:changed", null);

    // FIXME: if we added people, refresh the collections view too.

    Observers.notify(this, "snowl:subscribe:get:end", null);
  },

  _addMessage: function(message) {
    // We store the message text as both the subject and the content so that
    // the content shows up in the Subject column of the list view.
    // FIXME: make the list view automatically display some of the content
    // if the subject is missing so we don't have to duplicate storage here.
    let subject = message.text;

    // Get an existing identity or create a new one.  Creating an identity
    // automatically creates a person record with the provided name.
    let identity = SnowlIdentity.get(this.id, message.user.id) ||
                   SnowlIdentity.create(this.id,
                                        message.user.id,
                                        message.user.screen_name,
                                        message.user.url,
                                        message.user.profile_image_url);
    // FIXME: update the identity record with the latest info about the person.
    //identity.updateProperties(this.machineURI, message.user);
    let authorID = identity.personID;

    let timestamp = new Date(message.created_at);

    // Add the message.
    let messageID = this.addSimpleMessage(this.id, message.id, subject, authorID, timestamp, null);

    // Add the message's content.
    this.addPart(messageID, PART_TYPE_CONTENT, message.text, null, null, "text/plain");

    // Add the message's metadata.
    for (let [name, value] in Iterator(message)) {
      // Ignore properties we have already handled specially.
      // XXX Should we add them anyway, which is redundant info but lets others
      // (who don't know about our special treatment) access them?
      if (["user", "created_at", "text"].indexOf(name) != -1)
        continue;

      // FIXME: populate a "recipient" field with in_reply_to_user_id.

      this._addMetadatum(messageID, name, value);
    }

    return messageID;
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
    // FIXME: external IDs may be source-specific, as some sources
    // (like Twitter) don't use globally-unique IDs (unlike feeds, which
    // generally do), so handle non-globally unique IDs correctly.
    return SnowlDatastore.selectInternalIDForExternalID(aExternalID);
  },

  /**
   * Add a message with a single part to the datastore.
   *
   * @param aSourceID    {integer} the record ID of the message source
   * @param aExternalID  {string}  the external ID of the message
   * @param aSubject     {string}  the title of the message
   * @param aAuthorID    {string}  the author of the message
   * @param aTimestamp   {Date}    the date/time at which the message was sent
   * @param aLink        {nsIURI}  a link to the content of the message,
   *                               if the content is hosted on a server
   *
   * @returns {integer} the internal ID of the newly-created message
   */
  addSimpleMessage: function(aSourceID, aExternalID, aSubject, aAuthorID,
                             aTimestamp, aLink) {
    // Convert the timestamp to milliseconds-since-epoch, which is how we store
    // it in the datastore.
    let timestamp = aTimestamp ? aTimestamp.getTime() : null;

    // Convert the link to its string spec, which is how we store it
    // in the datastore.
    let link = aLink ? aLink.spec : null;

    let messageID =
      SnowlDatastore.insertMessage(aSourceID, aExternalID, aSubject, aAuthorID,
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

  // FIXME: factor this out with the identical function in feed.js.
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
