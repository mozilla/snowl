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
Cu.import("resource://snowl/modules/URI.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/constants.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/utils.js");

/**
 * SnowlSource: a source of messages.
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
let SnowlSource = {
  init: function(aID, aName, aMachineURI, aHumanURI, aUsername, aLastRefreshed, aImportance) {
    this.id = aID;
    this.name = aName;
    this.machineURI = aMachineURI;
    this.humanURI = aHumanURI;
    this.username = aUsername;
    this._lastRefreshed = aLastRefreshed;
    this.importance = aImportance;
  },

  // How often to refresh sources, in milliseconds.
  refreshInterval: 1000 * 60 * 30, // 30 minutes

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
  // was checked for updates to its set of messages.
  _lastRefreshed: null,

  get lastRefreshed() {
    return this._lastRefreshed;
  },

  set lastRefreshed(newValue) {
    this._lastRefreshed = newValue;

    let stmt = SnowlDatastore.createStatement("UPDATE sources " +
                                              "SET lastRefreshed = :lastRefreshed " +
                                              "WHERE id = :id");
    stmt.params.lastRefreshed = SnowlDateUtils.jsToJulianDate(this._lastRefreshed);
    stmt.params.id = this.id;
    stmt.execute();
  },

  // An integer representing how important this source is to the user
  // relative to other sources to which the user is subscribed.
  importance: null,

  // Favicon Service
  get faviconSvc() {
    let faviconSvc = Cc["@mozilla.org/browser/favicon-service;1"].
                     getService(Ci.nsIFaviconService);
    this.__defineGetter__("faviconSvc", function() faviconSvc);
    return this.faviconSvc;
  },

  get faviconURI() {
    if (this.humanURI) {
      try {
        return this.faviconSvc.getFaviconForPage(this.humanURI);
      }
      catch(ex) { /* no known favicon */ }
    }

    // The default favicon for feed sources.
    // FIXME: once we support other types of sources, override this
    // with a type-specific icon.
    //return URI.get("chrome://snowl/skin/livemarkFolder-16.png");

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

  /**
   * Insert a record for this source into the database, or update an existing
   * record.
   *
   * FIXME: move this to a SnowlAccount interface.
   * XXX need to make this one commitable transaction (with place db store)
   * to maintain strict integrity..
   * XXX store placesID back into messages for db integrity..
   */
  persist: function() {
    // 
    let statement;
    if (this.id) {
      statement = SnowlDatastore.createStatement(
        "UPDATE sources " +
        "SET     name = :name,       " +
        "        type = :type,       " +
        "  machineURI = :machineURI, " +
        "    humanURI = :humanURI,   " +
        "    username = :username    " +
        "WHERE     id = :id"
      );
    }
    else {
      statement = SnowlDatastore.createStatement(
        "INSERT INTO sources ( name,  type,  machineURI,  humanURI,  username) " +
        "VALUES              (:name, :type, :machineURI, :humanURI, :username)"
      );
    }

    try {
      statement.params.name = this.name;
      statement.params.type = this.constructor.name;
      statement.params.machineURI = this.machineURI.spec;
      statement.params.humanURI = this.humanURI.spec;
      statement.params.username = this.username;
      if (this.id)
        statement.params.id = this.id;
      statement.step();
    }
    finally {
      statement.reset();
    }

    // Extract the ID of the source from the newly-created database record.
    let placesID;
    if (!this.id) {
      this.id = SnowlDatastore.dbConnection.lastInsertRowID;
      placesID = SnowlDatastorePlaces.persistPlace("Sources",
                                                   this.id,
                                                   this.name,
//                                                   this.machineURI.spec,
//                                                   this.username,
                                                   this.id); // aSourceID
//this._log.info("persistSources id:placesID - " + this.id + " : " + placesID);

    }
  },

  get _stmtGetInternalIDForExternalID() {
    let statement = SnowlDatastore.createStatement(
      "SELECT id FROM messages WHERE sourceID = :sourceID AND externalID = :externalID"
    );
    this.__defineGetter__("_stmtGetInternalIDForExternalID", function() statement);
    return this._stmtGetInternalIDForExternalID;
  },

  /**
   * Get the internal ID of the message with the given external ID.
   *
   * @param    externalID   {String}
   *           the external ID of the message
   *
   * @returns  {Number}
   *           the internal ID of the message, or undefined if the message
   *           doesn't exist
   */
  _getInternalIDForExternalID: function(externalID) {
    let internalID;

    try {
      this._stmtGetInternalIDForExternalID.params.sourceID = this.id;
      this._stmtGetInternalIDForExternalID.params.externalID = externalID;
      if (this._stmtGetInternalIDForExternalID.step())
        internalID = this._stmtGetInternalIDForExternalID.row["id"];
    }
    finally {
      this._stmtGetInternalIDForExternalID.reset();
    }

    return internalID;
  },

  get _stmtInsertPart() {
    let statement = SnowlDatastore.createStatement(
      "INSERT INTO parts( messageID,  content,  mediaType,  partType,  baseURI,  languageTag) " +
      "VALUES           (:messageID, :content, :mediaType, :partType, :baseURI, :languageTag)"
    );
    this.__defineGetter__("_stmtInsertPart", function() statement);
    return this._stmtInsertPart;
  },

  get _stmtInsertPartText() {
    let statement = SnowlDatastore.createStatement(
      "INSERT INTO partsText( docid,  content) " +
      "VALUES               (:docid, :content)"
    );
    this.__defineGetter__("_stmtInsertPartText", function() statement);
    return this._stmtInsertPartText;
  },

  /**
   * Add a message part (i.e. a portion of its content) to the datastore.
   *
   * FIXME: make a version of this method that takes an nsITextConstruct
   * to improve performance for sources (like SnowlFeed) that get content
   * in that form.
   *
   * @param messageID     {integer}
   *        the ID of the message to which the part belongs
   *
   * @param content       {string}
   *        the content of the part
   *
   * @param mediaType     {string}
   *        the type of content it contains (plaintext, HTML, etc.);
   *        must be an Internet media type (text/plain, image/png, etc.)
   *
   * @param partType      {integer}   [optional]
   *        the kind of part it is (content, summary, attachment, etc.);
   *        must be one of the PART_TYPE_* constants defined in constants.js
   *
   * @param baseURI       {nsIURI}    [optional]
   *        the URI against which to resolve relative references in the content;
   *        only matters for (X)HTML content
   *
   * @param languageTag   {string}    [optional]
   *        the language in which the content is written;
   *        must be an IETF language tag (en-US, fr, etc.)
   *
   * @returns the ID of the part
   */
  addPart: function(messageID, content, mediaType, partType, baseURI, languageTag) {
    // Insert the part into the parts table.
    this._stmtInsertPart.params.messageID     = messageID;
    this._stmtInsertPart.params.content       = content;
    this._stmtInsertPart.params.mediaType     = mediaType;
    this._stmtInsertPart.params.partType      = partType || PART_TYPE_CONTENT;
    this._stmtInsertPart.params.baseURI       = (baseURI ? baseURI.spec : null);
    this._stmtInsertPart.params.languageTag   = languageTag || null;
    this._stmtInsertPart.execute();
    let id = SnowlDatastore.dbConnection.lastInsertRowID;

    // Insert a plaintext version of the content into the partsText fulltext
    // table, converting it to plaintext first if necessary (and possible).
    let plainText = content;
    switch (mediaType) {
      case "text/html":
      case "application/xhtml+xml":
        // Use nsIFeedTextConstruct to convert the markup to plaintext.
        let (construct = Cc["@mozilla.org/feed-textconstruct;1"].
                         createInstance(Ci.nsIFeedTextConstruct)) {
          construct.text = content;
          construct.type = TEXT_CONSTRUCT_TYPES[mediaType];
          plainText = construct.plainText();
        }
        // Now that we've converted the markup to plaintext, fall through
        // to the text/plain case that inserts the data into the database.

      case "text/plain":
        // Give the fulltext record the same doc ID as the row ID of the parts
        // record so we can join them together to get the part (and thence the
        // message) when doing a fulltext search.
        this._stmtInsertPartText.params.docid = id;
        this._stmtInsertPartText.params.content = plainText;
        this._stmtInsertPartText.execute();
        break;

      default:
        // It isn't a type we understand, so don't do anything with it.
        // XXX If it's text/*, shouldn't we fulltext index it anyway?
    }
  }

};
