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
Cu.import("resource://snowl/modules/Mixins.js");
Cu.import("resource://snowl/modules/Observers.js");
Cu.import("resource://snowl/modules/Request.js");
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
  this.init(aID, aName, aMachineURI, aHumanURI, aUsername, aLastRefreshed, aImportance, aPlaceID);
}

SnowlFeed.prototype = {
  // The constructor property is defined automatically, but we destroy it
  // when we redefine the prototype, so we redefine it here in case we ever
  // need to check it to find out what kind of object an instance is.
  constructor: SnowlFeed,

  // XXX Move this to SnowlSource?
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


  //**************************************************************************//
  // Refreshment

  _refreshTime: null,
  _refreshCallback: null,

  /**
   * Refresh the feed, retrieving the latest information in it.
   *
   * @param time      {Date}
   *        The time the refresh was initiated; determines new messages'
   *        received time.  We let the caller specify this so a caller
   *        refreshing multiple feeds can give their messages the same
   *        received time.
   * @param callback  {Function}
   */
  refresh: function(time, callback) {
    this._refreshTime = time;
    this._refreshCallback = callback;

    // FIXME: remove subscribe from this notification's name.
    Observers.notify("snowl:subscribe:connect:start", this);
    this._log.info("refreshing " + this.machineURI.spec);

    new Request({
      loadCallback:           new Callback(this.onRefreshLoad, this),
      errorCallback:          new Callback(this.onRefreshError, this),
      // The feed processor is going to parse the XML, so override the MIME type
      // in order to turn off parsing by XMLHttpRequest itself.
      overrideMimeType:       "text/plain",
      url:                    this.machineURI,
      // Register a listener for notification callbacks so we handle
      // authentication.
      notificationCallbacks:  this
    });

    // We set the last refreshed timestamp here even though the refresh
    // is asynchronous, so we don't yet know whether it has succeeded.
    // The upside of this approach is that we don't keep trying to refresh
    // a source that isn't responding, but the downside is that it takes
    // a long time for us to refresh a source that is only down for a short
    // period of time.  We should instead keep trying when a source fails,
    // but with a progressively longer interval (up to the standard one).
    // FIXME: implement the approach described above.
    this.lastRefreshed = time;
  },

  onRefreshLoad: function(event) {
    let request = event.target;

    // The load event can fire even with a non 2xx code, so handle as error
    if (request.status < 200 || request.status > 299) {
      this.onRefreshError(event);
      return;
    }

    // XXX What's the right way to handle this?
    if (request.responseText.length == 0) {
      this.onRefreshError(event);
      return;
    }

    // XXX Perhaps we should set this._lastStatus = request.status so we don't
    // need to pass it in this notification and it's available at any time.
    // FIXME: remove subscribe from this notification's name.
    Observers.notify("snowl:subscribe:connect:end", this, request.status);

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
        this.self.onRefreshResult(result);
      }
    };
    parser.parseFromString(request.responseText, request.channel.URI);

    this._resetRefresh();
  },

  onRefreshError: function(event) {
    let request = event.target;

    // Sometimes an attempt to retrieve status text throws NS_ERROR_NOT_AVAILABLE.
    let statusText;
    try { statusText = request.statusText } catch(ex) { statusText = "[no status text]" }
    this._log.error("onRefreshError: " + request.status + " (" + statusText + ")");
    // XXX Perhaps we should set this._lastStatus = request.status so we don't
    // need to pass it in this notification and it's available at any time.
    // FIXME: remove subscribe from this notification's name.
    Observers.notify("snowl:subscribe:connect:end", this, request.status);

    this._resetRefresh();

    if (this._subscribeCallback)
      this._subscribeCallback();
  },

  onRefreshResult: strand(function(result) {
    // FIXME: figure out why result.doc is sometimes null (perhaps its content
    // isn't a valid feed?) and report a more descriptive error message.
    if (result.doc == null) {
      this._log.error("onRefreshResult: result.doc is null");
      // FIXME: factor this out with similar code in onSubscribeError and make
      // the observers of snowl:subscribe:connect:end understand the status
      // we return.
      // FIXME: remove subscribe from this notification's name.
      Observers.notify("snowl:subscribe:connect:end", this, "result.doc is null");
      if (this._subscribeCallback)
        this._subscribeCallback();
      return;
    }

    try {
      let feed = result.doc.QueryInterface(Ci.nsIFeed);

      // Extract the name and human URI (if we don't already have them)
      // from the feed.
      // ??? Should we update these if they've changed?
      if (!this.name)
        this.name = feed.title.plainText();
      if (!this.humanURI)
        this.humanURI = feed.link;

      // FIXME: remove subscribe from this notification's name.
      Observers.notify("snowl:subscribe:get:start", this);
      this.messages = this._processFeed(feed, this._refreshTime);
      // FIXME: remove subscribe from this notification's name.
      Observers.notify("snowl:subscribe:get:end", this);
    }
    catch(ex) {
      this._log.error("error on subscribe result: " + ex);
      // FIXME: remove subscribe from this notification's name.
      // FIXME: make this something besides "connect:end" since we've already
      // issued one of those notifications by now.
      Observers.notify("snowl:subscribe:connect:end", this, "error: " + ex);
    }
    finally {
      if (this._subscribeCallback)
        this._subscribeCallback();
    }
  }),

  _resetRefresh: function() {
    this._refreshTime = null;
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

    for (let i = 0; i < feed.items.length; i++) {
      let entry = feed.items.queryElementAt(i, Ci.nsIFeedEntry);

      // Figure out the ID for the entry, then check if the entry has already
      // been retrieved.  If the entry doesn't provide its own ID, we generate
      // one for it based on its content.
      try {
        let externalID = entry.id || this._generateID(entry);
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

    message.sourceID = this.id;
    message.externalID = aExternalID;
    message.subject = aEntry.title.text;
    message.timestamp = aEntry.updated               ? new Date(aEntry.updated)
                      : aEntry.published             ? new Date(aEntry.published)
                      : aEntry.fields.get("dc:date") ? ISO8601DateUtils.parse(aEntry.fields.get("dc:date"))
                      : null;
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

Mixins.mix(SnowlSource).into(SnowlFeed);
Mixins.mix(SnowlSource.prototype).into(SnowlFeed.prototype);
SnowlService.addAccountType(SnowlFeed);
