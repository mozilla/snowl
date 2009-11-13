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

let EXPORTED_SYMBOLS = ["SnowlSource"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

// modules that are generic
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/Observers.js");
Cu.import("resource://snowl/modules/Sync.js");
Cu.import("resource://snowl/modules/URI.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/constants.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/message.js");
Cu.import("resource://snowl/modules/service.js");
Cu.import("resource://snowl/modules/utils.js");

// FIXME: make strands.js into a module.
let loader = Cc["@mozilla.org/moz/jssubscript-loader;1"].getService(Ci.mozIJSSubScriptLoader);
loader.loadSubScript("chrome://snowl/content/strands.js");

/**
 * SnowlSource: a source of messages.
 *
 * FIXME: update this documentation now that we're using it via mixins
 * instead of inheritance.
 *
 * This is an abstract class that should not be instantiated. Rather, objects
 * should inherit it via one of two methods (depending on whether or not they
 * also inherit other functionality):
 *
 * Objects that only inherit SnowlSource may assign it to their prototype
 * (or to their prototype's prototype) and then declare overridden attributes
 * as appropriate, with the prototype chain automatically delegating other
 * attributes to SnowlSource:
 *
 *   function MySource = {
 *     SnowlSource.init.call(this, ...);
 *     this.overriddenMethod: function(...) {...},
 *     this.overriddenProperty: "foo",
 *     this.__defineGetter("overriddenGetter", function() {...}),
 *     this.__defineSetter("overriddenSetter", function(newVal) {...}),
 *   }
 *   MySource.prototype = SnowlSource;
 *
 *     -- or --
 *
 *   function MySource = {
 *     SnowlSource.init.call(this, ...);
 *   }
 *   MySource.prototype = {
 *     __proto__: SnowlSource,
 *     overriddenMethod: function(...) {...},
 *     overriddenProperty: "foo",
 *     get overriddenGetter() {...},
 *     set overriddenSetter(newVal) {...}
 *   };
 *
 * Objects that inherit other functionality should redeclare every attribute
 * in SnowlSource, manually delegating to SnowlSource as appropriate:
 * FIXME: make it possible to import attributes instead of redeclaring them.
 *
 *   function MyThing = {
 *     SnowlSource.init.call(this, ...);
 *   }
 *
 *   MyThing.prototype = {
 *     overriddenMethod: function(...) {...},
 *     overriddenProperty: "foo",
 *     get overriddenGetter() {...},
 *     set overriddenSetter(newVal) {...}
 *
 *     delegatedMethod: function(...) {
 *       SnowlSource.call(this, ...);
 *     },
 *
 *     get delegatedProperty: function() {
 *       return SnowlSource.delegatedProperty;
 *     },
 *
 *     // It's dangerous to set the base class's properties; don't do this!!!
 *     set delegatedProperty: function(newVal) {
 *       SnowlSource.delegatedProperty = newVal;
 *     },
 *
 *     get delegatedGetter: function() {
 *       return SnowlSource.__lookupGetter__("delegatedGetter").call(this);
 *     },
 *
 *     set delegatedSetter: function(newVal) {
 *       SnowlSource.__lookupSetter__("delegatedSetter").call(this, newVal);
 *     }
 *   };
 *
 * Memoizing unary getters in this object must memoize to another getter
 * so that subclasses can call the getters directly without causing trouble
 * for other subclasses that access them via __lookupGetter__.
 */
function SnowlSource() {}

SnowlSource.retrieve = function(id) {
  let source = null;

  // FIXME: memoize this.
  let statement = SnowlDatastore.createStatement(
    "SELECT type, name, machineURI, humanURI, username, lastRefreshed, " +
    "       importance, placeID, attributes " +
    "FROM sources " +
    "WHERE id = :id"
  );

  try {
    statement.params.id = id;
    if (statement.step()) {
      let row = statement.row;
      let constructor;
      // Bleh, this function is called within the JS context for this module,
      // which means it doesn't know anything about other modules it doesn't
      // import (like SnowlFeed and SnowlTwitter).  The current hack to deal
      // with this is to set the constructor to |this| hoping that |this| is
      // the right constructor (which it is as long as this function got mixed
      // into the right constructor), but this isn't going to work when we want
      // to use this to pull all accounts and make them available in the service,
      // so we'll have to figure out something better to do then.
      try { constructor = eval(row.type) } catch(ex) { constructor = this };
      source = new constructor(id,
                               row.name,
                               URI.get(row.machineURI),
                               URI.get(row.humanURI),
                               row.username,
                               row.lastRefreshed ? SnowlDateUtils.julianToJSDate(row.lastRefreshed) : null,
                               row.importance,
                               row.placeID,
                               JSON.parse(row.attributes));
    }
  }
  finally {
    statement.reset();
  }

  return source;
}

SnowlSource.prototype = {
  init: function(aID, aName, aMachineURI, aHumanURI, aUsername,
                 aLastRefreshed, aImportance, aPlaceID, aAttributes) {
    this.id = aID;
    this.name = aName;
    this.machineURI = aMachineURI;
    this.humanURI = aHumanURI;
    this.username = aUsername;
    this.lastRefreshed = aLastRefreshed;
    // FIXME: make it so I don't have to set importance to null if it isn't
    // specified in order for its non-set value to remain null.
    this.importance = aImportance || null;
    this.placeID = aPlaceID;
    this.attributes = aAttributes || this.attributes;
  },

  get _log() {
    let logger = Log4Moz.repository.getLogger(this._logName);
    this.__defineGetter__("_log", function() logger);
    return this._log;
  },

  // For adding isBusy property to collections tree.
  busy: false,

  // For adding hasError property to collections tree.
  error: false,

  id: null,

  name: null,

  /**
   * The URL at which to find a machine-processable representation of the data
   * provided by the source.  For a feed source, this is the URL of its RSS/Atom
   * document; for an email source, it's the URL of its POP/IMAP server.
   */
  machineURI: null,

  /**
   * The codebase principal for the machine URI.  We use this to determine
   * whether or not the source can link to the links it provides, so we can
   * prevent sources from linking to javascript: and data: links that would
   * run with chrome privileges if inserted into our views.
   */
  get principal() {
    let securityManager = Cc["@mozilla.org/scriptsecuritymanager;1"].
                          getService(Ci.nsIScriptSecurityManager);
    let principal = securityManager.getCodebasePrincipal(this.machineURI);
    this.__defineGetter__("principal", function() principal);
    return this.principal;
  },

  // The URL at which to find a human-readable representation of the data
  // provided by the source.  For a feed source, this is the website that
  // publishes the feed; for an email source, it might be the webmail interface.
  humanURI: null,

  // The username with which the user gets authorized to access the account.
  username: null,

  // A JavaScript Date object representing the last time this source
  // was checked for updates to its set of messages.  If source attributes not
  // set to use default source type value *and* source type setting does not
  // override customizations on individual sources, then use the custom value.
  lastRefreshed: null,

  get refreshInterval() {
    return this.attributes.refresh["useDefault"] ||
        SnowlService._accountTypesByType[this.constructor.name].
                     attributes.refresh["useDefault"] ?
        SnowlService._accountTypesByType[this.constructor.name].
                     attributes.refresh["interval"] :
        this.attributes.refresh["interval"];
  },

  // An integer representing how important this source is to the user
  // relative to other sources to which the user is subscribed.
  importance: null,

  // The ID of the place representing this source in a list of collections.
  placeID: null,

  //**************************************************************************//
  // The default global attributes for a all sources.  Source types may override
  // and add their own attributes (but need to consider such exceptions in
  // generic handling).  The attributes objects are combined by Mixins.meld().
  attributes: {
    refresh: {
      // If true for the default Type, overrides individual setting; if
      // true for individual source, overrides default if default is false.
      useDefault: true,
      // 30 minutes
      interval: 1000 * 60 * 30,
      // Status determines behavior of auto and user refreshes:
      // 'active' - auto refresh on interval, immediately on user action
      // 'paused' - no refresh on auto or user action, set by user
      // 'disabled' - refresh only on user action, auto set on permanent error
      status: "active",
      // Code, usually response code, or internal error code.
      code: "",
      // Descriptive error message.
      text: ""
    },
    retention: {
      // If true for the default Type, overrides individual setting; if
      // true for individual source, overrides default if default is false.
      useDefault: true,
      // If 0, do not delete any messaged; if 1, delete by days; if 2 delete
      // by number of messages.
      deleteBy: 0,
      // If radio checked, delete messages older than number (of days).
      deleteDays: 30,
      // If radio checked, delete messages greater than number (of messages).
      deleteNumber: 500,
      // If true, messages will never be auto deleted.
      keepFlagged: true
    }
  },

  // The collection of messages from this source.
  messages: null,

  // Favicon Service
  get faviconSvc() {
    let faviconSvc = Cc["@mozilla.org/browser/favicon-service;1"].
                     getService(Ci.nsIFaviconService);
    this.__defineGetter__("faviconSvc", function() faviconSvc);
    return this.faviconSvc;
  },

  // XXX: If a favicon is not in cache, getFaviconForPage throws, but we do
  // not want to try getFaviconImageForPage as that returns a default moz image.
  // Perhaps overkill to try to get a data uri for the favicon via additional
  // favicon methods. So we will try the former, and use the below for first
  // time visits for sources we have so far, til this can be fixed properly.
  get faviconURI() {
    if (this.humanURI) {
      try {
        // If the page has been visited and the icon is in cache
        return this.faviconSvc.getFaviconForPage(this.humanURI);
      }
      catch(ex) {
        // Try to get the image, returns moz default if not found
//        return this.faviconSvc.getFaviconImageForPage(this.humanURI);
//        return this.faviconSvc.getFaviconLinkForIcon(this.humanURI);
      }
    }

    // The default favicon for feed sources.
    // FIXME: get icon from collections table instead of hardcoding
    if (this.constructor.name == "SnowlFeed")
      return URI.get("chrome://snowl/skin/livemarkFolder-16.png");

    // The default favicon for twitter.
    // FIXME: get icon from collections table instead of hardcoding
    if (this.constructor.name == "SnowlTwitter")
      return URI.get("http://static.twitter.com/images/favicon.ico");

    return null;
  },

  /**
   * Check for new messages and update the local store of messages to reflect
   * the latest updates available from the source.  This method is a stub that
   * is expected to be overridden by subclass implementations.
   *
   * @param   refreshTime   {Date}
   *          the time at which a refresh currently in progress began
   *          Note: we use this as the received time when adding messages to
   *          the datastore.  We get it from the caller instead of generating it
   *          ourselves to allow the caller to synchronize received times
   *          across refreshes of multiple sources, which makes message views
   *          sorted by received, then published look better for messages
   *          received in the same refresh cycle.
   */
  refresh: function(refreshTime) {},

  onRefreshError: function() {
    this.error = true;
    if (this.attributes.refresh["code"] == 401 ||
        this.attributes.refresh["code"] == 404) {
      this.attributes.refresh["status"] = "disabled";
      SnowlService.sourcesByID[this.id].attributes.refresh["status"] = "disabled";
    }

    this._log.error("Refresh error: " + this.attributes.refresh["text"]);
  },

  onDbCompleted: function() {
    // Database source record updated, set notifications and states.
    if (this.id) {
      // Only for existing stored sources; notify refreshes collections tree state.
      SnowlService.sourcesByID[this.id].busy = false;
      SnowlService.sourcesByID[this.id].error = this.error;
      SnowlService.refreshingCount = --SnowlService.refreshingCount;
    }
    Observers.notify("snowl:messages:completed", this.id);
  },

  onDbError: function() {
    this.error = true;
    if (this.id) {
      // Only for existing stored sources; notify refreshes collections tree state.
      SnowlService.sourcesByID[this.id].busy = false;
      SnowlService.sourcesByID[this.id].error = this.error;
      SnowlService.refreshingCount = --SnowlService.refreshingCount;
      Observers.notify("snowl:messages:completed", this.id);
    }
    this._log.error("Database error: " + this.attributes.refresh["text"]);
  },

  retrieveMessages: function() {
    // FIXME: memoize this.
    let messagesStatement = SnowlDatastore.createStatement(
      "SELECT id FROM messages WHERE sourceID = :id"
    );
    
    try {
      messagesStatement.params.id = id;
      this.messages = [];
      // FIXME: retrieve all messages at once instead of one at a time.
      while (messagesStatement.step())
        this.messages.push(SnowlMessage.retrieve(messagesStatement.row.id));
    }
    finally {
      messagesStatement.reset();
    }
  },

  /**
   * Insert a record for this source into the database, or update an existing
   * record; store placeID back into sources table.
   *
   * @param pauseBetweenMessages {Boolean}
   *        whether or not to pause between each message we persist; useful for
   *        mixing up messages received at the same time from different sources
   *        when refreshing multiple sources at once
   *
   * FIXME: move this to a SnowlAccount interface.
   */
  persist: function(pauseBetweenMessages) {
    let statement, placeID;
    if (this.id) {
      statement = SnowlDatastore.createStatement(
        "UPDATE sources " +
        "SET      name = :name,          " +
        "         type = :type,          " +
        "   machineURI = :machineURI,    " +
        "     humanURI = :humanURI,      " +
        "     username = :username,      " +
        "lastRefreshed = :lastRefreshed, " +
        "   importance = :importance,    " +
        "   attributes = :attributes     " +
        "WHERE      id = :id"
      );
    }
    else {
      statement = SnowlDatastore.createStatement(
        "INSERT INTO sources ( name,  type,  machineURI,  humanURI,  username, " +
        "                      lastRefreshed,  importance, attributes) " +
        "VALUES              ( :name, :type, :machineURI, :humanURI, :username, " +
        "                      :lastRefreshed, :importance, :attributes)"
      );
    }

    // Need to get a transaction lock.
    if (SnowlDatastore.dbConnection.transactionInProgress) {
      this.attributes.refresh["code"] = "db:transactionInProgress";
      this.attributes.refresh["text"] = "Database temporarily busy, could not get transaction lock";
      if (this.id) {
        // Only for existing stored sources; notify refreshes collections tree state.
        SnowlService.sourcesByID[this.id].busy = false;
        SnowlService.sourcesByID[this.id].error = this.error;
        SnowlService.refreshingCount = --SnowlService.refreshingCount;
//        Observers.notify("snowl:messages:completed", this.id);
      }
      else {
        // New subscriptions need to return feedback.
        this.error = true;
        this._log.info("persist: " + this.attributes.refresh["text"]);
      }

      return;
    }

    SnowlDatastore.dbConnection.beginTransaction();
    try {
      statement.params.name = this.name;
      statement.params.type = this.constructor.name;
      statement.params.machineURI = this.machineURI.spec;
      statement.params.humanURI = this.humanURI ? this.humanURI.spec : null;
      statement.params.username = this.username;
      statement.params.lastRefreshed = this.lastRefreshed ? SnowlDateUtils.jsToJulianDate(this.lastRefreshed) : null;
      statement.params.importance = this.importance;
      statement.params.attributes = JSON.stringify(this.attributes);
      if (this.id)
        statement.params.id = this.id;
      statement.step();
      if (!this.id) {
        // Extract the ID of the source from the newly-created database record.
        this.id = SnowlDatastore.dbConnection.lastInsertRowID;
        // New source, bump refreshing count.
        SnowlService.refreshingCount = ++SnowlService.refreshingCount;

        // Update message authors to include the source ID.
        // FIXME: make SnowlIdentity records have a source property
        // referencing a source object rather than a sourceID property
        // referencing a source object's ID.
        if (this.messages)
          for each (let message in this.messages)
            if (message.author)
              message.author.sourceID = this.id;

        // Create places record
        this.placeID = SnowlPlaces.persistPlace("sources",
                                                this.id,
                                                this.name,
                                                this.machineURI,
                                                null, // this.username,
                                                this.faviconURI,
                                                this.id); // aSourceID

        // Store placeID back into messages for db integrity
        SnowlDatastore.dbConnection.executeSimpleSQL(
          "UPDATE sources " +
          "SET    placeID = " + this.placeID +
          " WHERE      id = " + this.id);
        this._log.debug("persist placeID:sources.id - " + this.placeID + " : " + this.id);

        // Use 'added' here for collections observer for more specificity
        Observers.notify("snowl:source:added", this.placeID);
      }

      if (this.messages) {
        // Sort the messages by date, so we insert them from oldest to newest,
        // which makes them show up in the correct order in views that expect
        // messages to be inserted in that order and sort messages by their IDs.
        this.messages.sort(function(a, b) a.timestamp < b.timestamp ? -1 :
                                          a.timestamp > b.timestamp ?  1 : 0);

        let currentMessageIDs = [];
        let messagesChanged = false;

        for each (let message in this.messages) {
          let added = false;
          message.id = message._getInternalID();
          if (!message.id) {
            // Persist only new messages, ie without an id.
            this._log.info("persisting new message " + message.externalID);
      
            try {
              added = message.persist();
            }
            catch(ex) {
              this._log.error("couldn't persist " + message.externalID + ": " + ex);
              continue;
            }
          }

          if (messagesChanged == false && added)
            messagesChanged = true;
          currentMessageIDs.push(message.id);

          // Sleep for a bit to give other sources that are being refreshed
          // at the same time the opportunity to insert messages themselves,
          // so the messages appear mixed together in views that display them
          // by the order in which they are received, which is more pleasing
          // than if the messages were clumped together by source.
          // As a side effect, this might reduce horkage of the UI thread
          // during refreshes.
          if (pauseBetweenMessages)
            Sync.sleep(50);
        }

        // Update the current flag.
        this.updateCurrentMessages(currentMessageIDs);

        if (messagesChanged)
          // Invalidate stats cache on completion of refresh with new messages.
          SnowlService._collectionStatsByCollectionID = null;
      }

      SnowlDatastore.dbConnection.commitTransaction();

      // Source successfully stored/updated.
      this.onDbCompleted();
    }
    catch(ex) {
      SnowlDatastore.dbConnection.rollbackTransaction();
      this.attributes.refresh["code"] = "db:error";
      this.attributes.refresh["text"] = ex;
      this.onDbError();
    }
    finally {
      statement.reset();
    }

    return this.id;
  },

  get _persistAttributesStmt() {
    let statement = SnowlDatastore.createStatement(
      "UPDATE sources SET attributes = :attributes WHERE id = :id");
    this.__defineGetter__("_persistAttributesStmt", function() statement);
    return this._persistAttributesStmt;
  },

  persistAttributes: function() {
    try {
      this._persistAttributesStmt.params.id = this.id;
      this._persistAttributesStmt.params.attributes = JSON.stringify(this.attributes);
      this._persistAttributesStmt.step()
    }
    finally {
      this._persistAttributesStmt.reset();
    }
  },

  unstore: function() {
    SnowlDatastore.dbConnection.beginTransaction();
    try {
      // FIXME: delegate unstorage of messages and people to their respective
      // JavaScript representations.
      SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM partsText " +
          "WHERE docid IN " +
          "(SELECT id FROM parts WHERE messageID IN " +
          "(SELECT id FROM messages WHERE sourceID = " + this.id + "))");
      SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM parts " +
          "WHERE messageID IN " +
          "(SELECT id FROM messages WHERE sourceID = " + this.id + ")");
      SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM messages " +
          "WHERE sourceID = " + this.id);
      // FIXME: don't delete people unless the only identities with which
      // they are associated are identities associated with this source.
      SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM people " +
          "WHERE id IN " +
          "(SELECT personID FROM identities WHERE sourceID = " + this.id + ")");
      SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM identities " +
          "WHERE sourceID = " + this.id);
      SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM sources " +
          "WHERE id = " + this.id);

      // Finally, clean up Places bookmarks with sourceID in its prefixed uri.
      SnowlPlaces.removePlacesItemsByURI("snowl:sId=" + this.id, true);

      SnowlDatastore.dbConnection.commitTransaction();
    }
    catch(ex) {
      SnowlDatastore.dbConnection.rollbackTransaction();
      throw ex;
    }

    Observers.notify("snowl:source:unstored", this.id);
    this.id = null;
  },

  /**
   * Update the current flag for messages in a source, after a refresh.
   * If message's current flag = 1 set to 0, then set current flag for messages
   * in the current refresh list to 1.  Purge current and marked deleted
   * placeholder message records if no longer current.
   *
   * @param aCurrentMessageIDs  {array} messages table ids of the current list
   */
  updateCurrentMessages: function(aCurrentMessageIDs) {
    SnowlDatastore.dbConnection.executeSimpleSQL(
      "UPDATE messages SET current = " + MESSAGE_NON_CURRENT +
      " WHERE sourceID = " + this.id + " AND current = " + MESSAGE_CURRENT
    );
    SnowlDatastore.dbConnection.executeSimpleSQL(
      "UPDATE messages SET current = " + MESSAGE_CURRENT +
      " WHERE sourceID = " + this.id + " AND id IN" +
      " (" + aCurrentMessageIDs.join(", ") + ") AND current = " + MESSAGE_NON_CURRENT
    );
    SnowlDatastore.dbConnection.executeSimpleSQL(
      "DELETE FROM messages" +
      " WHERE sourceID = " + this.id + " AND" +
      "       current = " + MESSAGE_CURRENT_PENDING_PURGE + " AND" +
      "       id NOT IN (" + aCurrentMessageIDs.join(", ") + ")"
    );
  }

};
