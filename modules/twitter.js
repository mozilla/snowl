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

// modules that are generic
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/Mixins.js");
Cu.import("resource://snowl/modules/Observers.js");
Cu.import("resource://snowl/modules/request.js");
Cu.import("resource://snowl/modules/URI.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/constants.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/source.js");
Cu.import("resource://snowl/modules/target.js");
Cu.import("resource://snowl/modules/identity.js");
Cu.import("resource://snowl/modules/message.js");
Cu.import("resource://snowl/modules/utils.js");
Cu.import("resource://snowl/modules/service.js");

// FIXME: make strands.js into a module.
let loader = Cc["@mozilla.org/moz/jssubscript-loader;1"].getService(Ci.mozIJSSubScriptLoader);
loader.loadSubScript("chrome://snowl/content/strands.js");

const TYPE = "SnowlTwitter";
const NAME = "Twitter";
const MACHINE_URI = URI.get("https://twitter.com");
// XXX Should this be simply http://twitter.com ?
const HUMAN_URI = URI.get("http://twitter.com/home");

/**
 * The HTTP authentication realm under which to save credentials via the login
 * manager.  We save them under a realm whose name we define instead of the one
 * that Twitter provides (currently "Twitter API") because we set our own
 * Authorization header, and that happens before we get a response from Twitter,
 * so we can't depend on the value Twitter sets when it responds, because
 * we don't know it yet.
 *
 * Using our own realm also has the beneficial side effect that users browsing
 * their saved credentials in preferences will see our realm next to
 * the credentials that were saved by Snowl, which seems a better explanation
 * of where the credentials come from than the one Twitter provides.
 *
 * The reason we set our own Authorization header is that Necko assumes users
 * will only be logged into a single account for a given authentication realm
 * in any given session, so it caches credentials and reuses them for all
 * requests to the same realm.  Setting the Authorization header ourselves
 * ensures that we determine the credentials being used for our requests,
 * which is necessary to support multiple Twitter accounts.
 *
 * We could have theoretically worked around the problem by putting the username
 * into the URL (i.e. https://username@twitter.com...) and falling back on our
 * notification callback to get the saved credentials, by which point we'd know
 * the authentication realm.
 *
 * But experimentation showed that only worked for serialized requests;
 * concurrent requests (like when we refresh two Twitter accounts at the same
 * time asynchronously) cause Necko to again use the same credentials for both
 * refreshes, even though we've specified different usernames in the URLs
 * for those refreshes.
 *
 * And it had the side-effect that Necko stopped saving credentials at all
 * after the requests completed, so a user with a single account who didn't save
 * their credentials was prompted to enter them every time we refreshed.
 *
 * FIXME: file a bug on this bad behavior of Necko during concurrent requests.
 *
 * We could have also worked around the problem by also injecting the password
 * into the request URLs (i.e. https://username:password@twitter.com...),
 * but then we'd be putting passwords into URLs, which is considered harmful
 * because URLs leak into visible places (like the Error Console).
 */
const AUTH_REALM = "Snowl";

// This module is based on the API documented at http://apiwiki.twitter.com/.

// FIXME: make the constructor accept credentials instead of passing them
// to the subscribe function.

function SnowlTwitter(aID, aName, aMachineURI, aHumanURI, aUsername, aLastRefreshed, aImportance, aPlaceID) {
  // Use the given machine URI, if available.  We use this in unit tests
  // to point the account to a test server rather than the actual Twitter
  // servers.
  let machineURI = aMachineURI || MACHINE_URI;

  // FIXME: figure out a better solution than hanging the first mixed in init()
  // method on this object's prototype but calling the second one directly
  // because it didn't actually get mixed in because it already existed!
  this.init(aID, aName, machineURI, HUMAN_URI, aUsername, aLastRefreshed, aImportance, aPlaceID);
  SnowlTarget.prototype.init.call(this);
}

SnowlTwitter.prototype = {
  // The constructor property is defined automatically, but we destroy it
  // when we redefine the prototype, so we redefine it here in case we ever
  // need to check it to find out what kind of object an instance is.
  constructor: SnowlTwitter,

  get _log() {
    let logger = Log4Moz.repository.getLogger("Snowl.Twitter." + this.username);
    this.__defineGetter__("_log", function() logger);
    return this._log;
  },


  //**************************************************************************//
  // Abstract Class Composition Declarations

  _classes: [SnowlSource, SnowlTarget],

  implements: function(cls) {
    return (this._classes.indexOf(cls) != -1);
  },


  //**************************************************************************//
  // SnowlSource

  refreshInterval: 1000 * 60 * 3, // 3 minutes

  // refresh is defined elsewhere.


  //**************************************************************************//
  // SnowlTarget

  maxMessageLength: 140,

  // send is defined elsewhere.


  //**************************************************************************//
  // Notification Callbacks for Authentication

  // FIXME: factor this out with the equivalent code in feed.js.

  // If we prompt the user to authenticate, and the user asks us to remember
  // their password, we store the nsIAuthInformation in this property until
  // the request succeeds, at which point we store it with the login manager.
  _authInfo: null,

  get _loginManager() {
    let loginManager = Cc["@mozilla.org/login-manager;1"].
                       getService(Ci.nsILoginManager);
    this.__defineGetter__("_loginManager", function() loginManager);
    return this._loginManager;
  },

  /**
   * The saved credentials for this Twitter account, if any.
   * FIXME: we memoize this and never refresh it, which won't do once we have
   * long-lived account objects, so don't memoize this at all (attach it to
   * its request and kill it once the request is done) or invalidate it when
   * the set of credentials changes.
   */
  get _savedLogin() {
    // XXX Should we be using channel.URI.prePath instead of
    // this.machineURI.prePath in case the old URI redirects us to a new one
    // at a different hostname?
    return this._loginManager.
           findLogins({}, this.machineURI.prePath, null, AUTH_REALM).
           filter(function(login) login.username == this.username, this)
           [0];
  },

  // nsISupports

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIAuthPrompt2]),

  // nsIInterfaceRequestor

  getInterface: function(iid) {
    return this.QueryInterface(iid);
  },

  // nsIAuthPrompt2

  promptAuth: function(channel, level, authInfo) {
    this._log.debug("promptAuth: this.name = " + this.name + "; this.username = " + this.username);
    this._log.debug("promptAuth: this.name = " + this.name + "; authInfo.realm = " + authInfo.realm);

    let args = Cc["@mozilla.org/supports-array;1"].createInstance(Ci.nsISupportsArray);
    args.AppendElement({ wrappedJSObject: this });
    args.AppendElement(authInfo);

    // |result| is how the dialog passes information back to us.  It sets two
    // properties on the object:
    //   |proceed|, which we return from this function, and which determines
    //     whether or not authentication can proceed using the value(s) entered
    //     by the user;
    //   |remember|, which determines whether or not we save the user's login
    //     with the login manager once the request succeeds.
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
    else
      this._authInfo = null;

    return result.proceed;
  },

  asyncPromptAuth: function(channel, callback, context, level, authInfo) {
    this._log.debug("asyncPromptAuth: this.name = " + this.name + "; this.username = " + this.username);
    this._log.debug("asyncPromptAuth: this.name = " + this.name + "; authInfo.realm = " + authInfo.realm);

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
                            "chrome://snowl/content/loginAsync.xul",
                            null,
                            "chrome,centerscreen,dialog",
                            args);

    return {
      cancel: function() {
        win.QueryInterface(Ci.nsIDOMWindowInternal).close();
        callback.onAuthCancelled(context, false);
      }
    }
  },


  //**************************************************************************//
  // Refreshment

  get _stmtGetMaxExternalID() {
    let statement = SnowlDatastore.createStatement(
      "SELECT MAX(externalID) AS maxID FROM messages WHERE sourceID = :sourceID"
    );
    this.__defineGetter__("_stmtGetMaxExternalID", function() statement);
    return this._stmtGetMaxExternalID;
  },

  /**
   * Get the maximum external ID of the messages received from this source.
   * Newer messages always have larger integer IDs, so we can query for only
   * new messages by specifying since_id=[max ID] in the refresh request.
   *
   * @returns  {Number}
   *           the maximum external ID, if any
   */
  _getMaxExternalID: function() {
    let maxID = null;

    try {
      this._stmtGetMaxExternalID.params.sourceID = this.id;
      if (this._stmtGetMaxExternalID.step())
        maxID = this._stmtGetMaxExternalID.row["maxID"];
    }
    finally {
      this._stmtGetMaxExternalID.reset();
    }

    return maxID;
  },

  /**
   * Refresh the feed, retrieving the latest information in it.
   *
   * @param time        {Date}      [optional]
   *        when the refresh occurs; determines the received time of new
   *        messages; we let the caller specify this so a caller refreshing
   *        multiple feeds can give their messages the same received time
   */
  refresh: function(time) {
    if (typeof time == "undefined" || time == null)
      time = new Date();
//    this._log.info("start refresh " + this.username + " at " + time);

    Observers.notify("snowl:subscribe:get:start", this);

    // URL parameters that modify the return value of the request.
    let params = [];

    // Retrieve up to 200 messages, the maximum we're allowed to retrieve.
    params.push("count=200");

    // Retrieve only messages newer than the most recent one already retrieved.
    let (maxID = this._getMaxExternalID()) {
      if (maxID)
        params.push("since_id=" + maxID);
    }

    let url = this.machineURI.spec.replace(/^(https?:\/\/)/, "$1" + this.username + "@") +
              "statuses/friends_timeline.json?" + params.join("&");
    this._log.debug("refresh: this.name = " + this.name + "; url = " + url);

    let requestHeaders = {};

    // If the login manager has saved credentials for this account, provide them
    // to the server.  Otherwise, no worries, Necko will automatically call our
    // notification callback, which will prompt the user to enter their credentials.
    if (this._savedLogin) {
      this._log.info("setting Authorization header with username " + this.username);
      let credentials = btoa(this.username + ":" + this._savedLogin.password);
      requestHeaders.Authorization = "Basic " + credentials;
    }

    let request = new Request({
      url: url,
      notificationCallbacks: this,
      requestHeaders: requestHeaders
    });

    // FIXME: remove subscribe from this notification's name.
    Observers.notify("snowl:subscribe:connect:end", this, request.status);

    this.lastStatus = request.status + " (" + request.statusText + ")";
    if (request.status < 200 || request.status > 299 || request.responseText.length == 0) {
      this.onRefreshError();
      return;
    }

    // _authInfo only gets set if we prompted the user to authenticate
    // and the user checked the "remember password" box.  Since we're here,
    // it means the request succeeded, so we save the login.
    if (this._authInfo) {
      this._saveLogin(this._authInfo);
      this._authInfo = null;
    }

    let items = JSON.parse(request.responseText);
    this.messages = this._processItems(items, time);

    this.lastRefreshed = time;

    Observers.notify("snowl:subscribe:get:end", this);
  },


  //**************************************************************************//
  // Processing

  /**
   * Process an array of items (from the server) into an array of messages.
   *
   * @param items     {Array}   the items to process
   * @param received  {Date}    when the items were received
   */
  _processItems: function(items, received) {
    this._log.trace("processing items");

    let messages = [];

    for each (let item in items) {
      try {
        let message = this._processItem(item, received);
        messages.push(message);
      }
      catch(ex) {
        this._log.error("couldn't process item " + item.id + ": " + ex);
      }
    }

    return messages;
  },

  _processItem: function(item, received) {
    this._log.trace("processing item " + item.id);

    let message = new SnowlMessage();

    message.source = this;
    message.externalID = item.id;
    message.timestamp = new Date(item.created_at);
    message.received = received || new Date();
    message.author = new SnowlIdentity(null,
                                       this.id,
                                       item.user.id);
    message.author.person = new SnowlPerson(null,
                                            item.user.screen_name,
                                            null,
                                            item.user.url,
                                            item.user.profile_image_url);

    message.content =
      new SnowlMessagePart({
        partType:    PART_TYPE_CONTENT,
        content:     item.text,
        mediaType:   "text/plain"
      });

    // Add headers.
    message.headers = {};
    for (let [name, value] in Iterator(item)) {
      // FIXME: populate a "recipient" field with in_reply_to_user_id.
      if (name == "user") {
        for (let [uname, uvalue] in Iterator(value))
          message.headers["user:" + uname] = uvalue;
      }
      else
        message.headers[name] = value;
    }

    return message;
  },

  // XXX Perhaps factor this out with the identical function in feed.js,
  // although this function supports multiple accounts with the same server
  // and doesn't allow the user to change their username, so maybe that's
  // not possible (or perhaps we can reconcile those differences).
  _saveLogin: function(authInfo) {
    // Create a new login with the auth information we obtained from the user.
    let LoginInfo = new Components.Constructor("@mozilla.org/login-manager/loginInfo;1",
                                               Ci.nsILoginInfo,
                                               "init");
    // XXX Should we be using channel.URI.prePath in case the old URI
    // redirects us to a new one at a different hostname?
    let newLogin = new LoginInfo(this.machineURI.prePath,
                                 null,
                                 AUTH_REALM,
                                 authInfo.username,
                                 authInfo.password,
                                 "",
                                 "");

    // If there are credentials with the same username, we replace them.
    // Otherwise, we add the new credentials.
    if (this._savedLogin)
      this._loginManager.modifyLogin(this._savedLogin, newLogin);
    else
      this._loginManager.addLogin(newLogin);
  },


  //**************************************************************************//
  // Sending

  _successCallback: null,
  _errorCallback: null,

  send: function(content, successCallback, errorCallback) {
    Observers.notify("snowl:send:start", this);

    let data = "status=" + encodeURIComponent(content) + "&source=snowl";
    //          + "&in_reply_to_status_id=" + encodeURIComponent(inReplyToID);

    this._successCallback = successCallback;
    this._errorCallback   = errorCallback;

    let request = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance();

    // FIXME: make a TwitterRequest (or plain Request) object that caches
    // references to the callbacks and the SnowlTwitter instance so we don't
    // have to cache them in the object itself, which could cause problems
    // if we were to persist the instance and send multiple messages through
    // it simultaneously.

    request.QueryInterface(Ci.nsIDOMEventTarget);
    let (t = this) {
      request.addEventListener("load", function(e) { t.onSendLoad(e) }, false);
      request.addEventListener("error", function(e) { t.onSendError(e) }, false);
    }

    request.QueryInterface(Ci.nsIXMLHttpRequest);
    request.open("POST", this.machineURI.spec.replace(/^(https?:\/\/)/, "$1" + this.username + "@") +
                         "statuses/update.json", true);
    // If the login manager has saved credentials for this account, provide them
    // to the server.  Otherwise, no worries, Necko will automatically call our
    // notification callback, which will prompt the user to enter their credentials.
    if (this._savedLogin) {
      let credentials = btoa(this.username + ":" + this._savedLogin.password);
      request.setRequestHeader("Authorization", "Basic " + credentials);
    }
    request.channel.notificationCallbacks = this;
    request.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
    request.send(data);
  },

  onSendLoad: function(event) {
    let request = event.target;

    // FIXME: the next three chunks of code are the same for multiple
    // load handlers; find some way to factor them out.

    // If the request failed, let the error handler handle it.
    // XXX Do we need this?  Don't such failures call the error handler directly?
    if (request.status < 200 || request.status > 299) {
      this.onSendError(event);
      return;
    }

    // If the response is empty, assume failure.
    // XXX What's the right way to handle this?
    if (request.responseText.length == 0) {
      this.onSendError(event);
      return;
    }

    this._log.info("onSendLoad: " + request.responseText);

    // _authInfo only gets set if we prompted the user to authenticate
    // and the user checked the "remember password" box.  Since we're here,
    // it means the request succeeded, so we save the login.
    if (this._authInfo)
      this._saveLogin(this._authInfo);

    this._processSend(request.responseText);

    if (this._successCallback)
      this._successCallback();

    this._resetSend();
  },

  onSendError: function(event) {
    let request = event.target;

    // Sometimes an attempt to retrieve status text throws NS_ERROR_NOT_AVAILABLE
    let statusText = "";
    try { statusText = request.statusText } catch(ex) {}
    
    this._log.error("onSendError: " + request.status + " (" + statusText + ")");

    if (this._errorCallback)
      this._errorCallback();

    this._resetSend();
  },

  _processSend: function(responseText) {
    let JSON = Cc["@mozilla.org/dom/json;1"].createInstance(Ci.nsIJSON);
    let item = JSON.decode(responseText);
    let message = this._processItem(item);
    message.persist();
  },

  _resetSend: function() {
    this._successCallback = null;
    this._errorCallback = null;
    this._authInfo = null;
  }
};

Mixins.mix(SnowlSource).into(SnowlTwitter);
Mixins.mix(SnowlSource.prototype).into(SnowlTwitter.prototype);
Mixins.mix(SnowlTarget).into(SnowlTwitter);
Mixins.mix(SnowlTarget.prototype).into(SnowlTwitter.prototype);
SnowlService.addAccountType(SnowlTwitter);
