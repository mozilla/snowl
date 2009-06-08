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

let EXPORTED_SYMBOLS = ["SnowlMessage", "SnowlMessagePart"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

// modules that come with Firefox
Cu.import("resource://gre/modules/utils.js"); // Places

// modules that are generic
Cu.import("resource://snowl/modules/Observers.js");
Cu.import("resource://snowl/modules/URI.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/constants.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/identity.js");
Cu.import("resource://snowl/modules/service.js");
Cu.import("resource://snowl/modules/source.js");
Cu.import("resource://snowl/modules/utils.js");

function SnowlMessage(props) {
  // The way this currently works requires instantiators to pass the value
  // of the read property via its private name _read, which seems wrong.
  // FIXME: make it so callers can pass read via its public name.
  for (let name in props)
    this[name] = props[name];
}

// FIXME: refactor this with the similar code in the SnowlCollection::messages getter.
// FIXME: retrieve multiple messages in a single query.
SnowlMessage.retrieve = function(id) {
  let message;

  // FIXME: memoize this.
  let statement = SnowlDatastore.createStatement(
    "SELECT sourceID, subject, authorID, timestamp, received, link, current, read " +
    "FROM messages WHERE messages.id = :id"
  );

  try {
    statement.params.id = id;
    if (statement.step()) {
      message = new SnowlMessage({
        id:         id,
        sourceID:   statement.row.sourceID,
        subject:    statement.row.subject,
        timestamp:  SnowlDateUtils.julianToJSDate(statement.row.timestamp),
        received:   SnowlDateUtils.julianToJSDate(statement.row.received),
        link:       statement.row.link ? URI.get(statement.row.link) : null,
        read:       (statement.row.read ? true : false),
        current:    statement.row.current,
      });

      if (statement.row.authorID) {
        message.author = SnowlIdentity.retrieve(statement.row.authorID);
        // Duplicate the author name in the authorName property so sorting
        // by author in the list view works.
        // FIXME: come up with a better fix for this hack.
        message.authorName = message.author.person.name;
      }
    }
  }
  finally {
    statement.reset();
  }

  message.summary = message._getPart(PART_TYPE_SUMMARY);
  message.content = message._getPart(PART_TYPE_CONTENT);

  return message;
};

SnowlMessage.delete = function(aMessage) {
  let message = aMessage;
  let messageID = message.id;
  let current = message.current;

  SnowlDatastore.dbConnection.beginTransaction();
  try {
    // Delete messages
    SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM partsText " +
        "WHERE docid IN " +
        "(SELECT id FROM parts WHERE messageID = " + messageID + ")");
//this._log.info("_deleteMessages: Delete messages PARTSTEXT DONE");
    SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM parts " +
        "WHERE messageID  = " + messageID);
//this._log.info("_deleteMessages: Delete messages PARTS DONE");
    // If a message is current and marked deleted, need to keep the record so
    // duplicates are not re added upon refresh.  So we move to a pending purge
    // state and delete the rest of the message.
    if (current == MESSAGE_CURRENT_DELETED)
      SnowlDatastore.dbConnection.executeSimpleSQL("UPDATE messages " +
          "SET current = " + MESSAGE_CURRENT_PENDING_PURGE +
          " WHERE id = " + messageID);
    else
      SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM messages " +
          "WHERE id = " + messageID);
//this._log.info("_deleteMessages: Delete messages DONE");
    if (message.author && !SnowlService.hasAuthorMessage(message.author.person.id)) {
      // Delete people/identities; author's only message has been deleted.
      SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM people " +
          "WHERE id = " + message.author.person.id);
      SnowlDatastore.dbConnection.executeSimpleSQL("DELETE FROM identities " +
          "WHERE id = " + message.author.id);
      // Finally, clean up Places bookmark by author's placeID.  A collections
      // tree rebuild is triggered by Places on removeItem of a visible item,
      // triggering a select event.  Need to bypass in onSelect.
      SnowlMessage.prototype.CollectionsView.noSelect = true;
      PlacesUtils.bookmarks.removeItem(message.author.person.placeID);
//this._log.info("_deleteMessages: Delete DONE authorID - "+authorID);
    }
//        PlacesUtils.history.removePage(URI(this.MESSAGE_URI + messageID));
//SnowlPlaces._log.info("_deleteMessages: Delete DONE messageID - "+messageID);

    SnowlDatastore.dbConnection.commitTransaction();
  }
  catch(ex) {
    SnowlDatastore.dbConnection.rollbackTransaction();
    throw ex;
  }
};

SnowlMessage.markDeleted = function(aMessage) {
  let message = aMessage;
  let messageID = message.id;

  SnowlDatastore.dbConnection.beginTransaction();
  try {
    // Mark message deleted, make sure this caller checks for non delete status first.
    SnowlDatastore.dbConnection.executeSimpleSQL(
      "UPDATE messages SET current =" +
      " (CASE WHEN current = " + MESSAGE_NON_CURRENT +
      "       THEN " + MESSAGE_NON_CURRENT_DELETED +
      "       WHEN current = " + MESSAGE_CURRENT +
      "       THEN " + MESSAGE_CURRENT_DELETED +
      "  END)" +
      " WHERE id = " + messageID
    );

    SnowlDatastore.dbConnection.commitTransaction();
  }
  catch(ex) {
    SnowlDatastore.dbConnection.rollbackTransaction();
    throw ex;
  }
};

SnowlMessage.prototype = {
  id: null,
  externalID: null,
  subject: null,
  author: null,
  link: null,
  timestamp: null,
  received: null,
  read: false,
  // FIXME: we don't need to set sourceID if we always set source,
  // so figure out if that's the case and update this code accordingly.
  sourceID: null,
  // FIXME: make sure there aren't any consumers that expect us to provide this
  // automatically from the persistent datastore, which we used to do.
  source: null,
  summary: null,
  content: null,

  get excerpt() {
    let construct = this.content || this.summary;

    if (!construct)
      return null;

    let contentText = construct.plainText();

    // XXX Does an ellipsis need to be localizable?
    // FIXME: use a real ellipsis character (…, a.k.a. &hellip;).
    return contentText.substring(0, 140) + (contentText.length > 140 ? "..." : "");
  },

  get _getPartStatement() {
    let statement = SnowlDatastore.createStatement(
      "SELECT content, mediaType, baseURI, languageTag FROM parts " +
      "WHERE messageID = :messageID AND partType = :partType"
    );
    this.__defineGetter__("_getPartStatement", function() { return statement });
    return this._getPartStatement;
  },

  _getPart: function(aPartType) {
    let part = null;

    try {
      this._getPartStatement.params.messageID = this.id;
      this._getPartStatement.params.partType = aPartType;
      if (this._getPartStatement.step()) {
        part = new SnowlMessagePart({ partType:    aPartType,
                                      content:     this._getPartStatement.row.content,
                                      mediaType:   this._getPartStatement.row.mediaType,
                                      baseURI:     URI.get(this._getPartStatement.row.baseURI),
                                      languageTag: this._getPartStatement.row.languageTag });
      }
    }
    finally {
      this._getPartStatement.reset();
    }

    return part;
  },

  get _stmtInsertMessage() {
    let statement = SnowlDatastore.createStatement(
      "INSERT INTO messages(sourceID, externalID, subject, authorID, timestamp, received, link, read) \
       VALUES (:sourceID, :externalID, :subject, :authorID, :timestamp, :received, :link, :read)"
    );
    this.__defineGetter__("_stmtInsertMessage", function() { return statement });
    return this._stmtInsertMessage;
  },

  /**
   * Persist the message to the messages table.
   *
   * FIXME: make this update an existing record.
   * 
   * @returns {integer} the ID of the newly-created record
   */
  persist: function() {
    // We can't begin a transaction here because the database engine does not
    // support nested transactions, and we get called from the message source's
    // persist method, which calls us from within a transaction.

    let added = false;

    if (this.author)
      this.author.persist();

    if (!this.id)
      this.id = this._getInternalID();

    if (this.id) {
      // FIXME: update the existing record as appropriate.
    }
    else {
      added = true;

      this._stmtInsertMessage.params.sourceID   = this.sourceID;
      this._stmtInsertMessage.params.externalID = this.externalID;
      this._stmtInsertMessage.params.subject    = this.subject;
      this._stmtInsertMessage.params.authorID   = this.author ? this.author.id : null;
      this._stmtInsertMessage.params.timestamp  = SnowlDateUtils.jsToJulianDate(this.timestamp);
      this._stmtInsertMessage.params.received   = SnowlDateUtils.jsToJulianDate(this.received);
      this._stmtInsertMessage.params.link       = this.link ? this.link.spec : null;
      this._stmtInsertMessage.params.read       = this.read;
      this._stmtInsertMessage.execute();
  
      this.id = SnowlDatastore.dbConnection.lastInsertRowID;
    }

    if (this.content)
      this.content.persist(this);
    if (this.summary)
      this.summary.persist(this);

    if (added)
      Observers.notify("snowl:message:added", this);

    return added;
  },

  get _getInternalIDStmt() {
    let statement = SnowlDatastore.createStatement(
      "SELECT id FROM messages WHERE sourceID = :sourceID AND externalID = :externalID"
    );
    this.__defineGetter__("_getInternalIDStmt", function() statement);
    return this._getInternalIDStmt;
  },

  /**
   * Get the internal ID of the message.
   *
   * @returns  {Number}
   *           the internal ID of the message, or undefined if the message
   *           doesn't exist in the datastore
   */
  _getInternalID: function() {
    let internalID;

    try {
      this._getInternalIDStmt.params.sourceID = this.source.id;
      this._getInternalIDStmt.params.externalID = this.externalID;
      if (this._getInternalIDStmt.step())
        internalID = this._getInternalIDStmt.row["id"];
    }
    finally {
      this._getInternalIDStmt.reset();
    }

    return internalID;
  },

  get CollectionsView() {
    delete this._CollectionsView;
    return this._CollectionsView = SnowlService.gBrowserWindow.document.
                                                getElementById("sidebar").
                                                contentWindow.CollectionsView;
  }

};

function SnowlMessagePart(properties) {
  [this[name] = properties[name] for (name in properties)];
}

SnowlMessagePart.prototype = {
  id:           null,
  partType:     null,
  content:      null,
  mediaType:    null,
  baseURI:      null,
  languageTag:  null,

  get textConstruct() {
    let textConstruct = Cc["@mozilla.org/feed-textconstruct;1"].
                        createInstance(Ci.nsIFeedTextConstruct);
    textConstruct.text = this.content;
    textConstruct.type = TEXT_CONSTRUCT_TYPES[this.mediaType];
    textConstruct.base = this.baseURI;
    textConstruct.lang = this.languageTag;
    this.__defineGetter__("textConstruct", function() textConstruct);
    return this.textConstruct;
  },

  // Implement nsIFeedTextConstruct properties for backwards-compatibility
  // until we update all callers to use the new API for this object.
  get text() this.textConstruct.text,
  get type() this.textConstruct.type,
  get base() this.textConstruct.base,
  get lang() this.textConstruct.lang,

  plainText: function() this.textConstruct.plainText(),
  createDocumentFragment: function(element) this.textConstruct.createDocumentFragment(element),

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

  persist: function(message) {
    if (message.id) {
      // FIXME: update the existing record as appropriate.
    }
    else {
      this._stmtInsertPart.params.messageID     = message.id;
      this._stmtInsertPart.params.partType      = this.partType;
      this._stmtInsertPart.params.content       = this.content;
      this._stmtInsertPart.params.mediaType     = this.mediaType;
      this._stmtInsertPart.params.baseURI       = (this.baseURI ? this.baseURI.spec : null);
      this._stmtInsertPart.params.languageTag   = this.languageTag;
      this._stmtInsertPart.execute();
  
      this.id = SnowlDatastore.dbConnection.lastInsertRowID;
  
      // Insert a plaintext version of the content into the partsText fulltext
      // table, converting it to plaintext first if necessary (and possible).
      switch (this.mediaType) {
        case "text/html":
        case "application/xhtml+xml":
        case "text/plain":
          // Give the fulltext record the same doc ID as the row ID of the parts
          // record so we can join them together to get the part (and thence the
          // message) when doing a fulltext search.
          this._stmtInsertPartText.params.docid = this.id;
          this._stmtInsertPartText.params.content = this.plainText();
          this._stmtInsertPartText.execute();
          break;
  
        default:
          // It isn't a type we understand, so don't do anything with it.
          // XXX If it's text/*, shouldn't we fulltext index it anyway?
      }
    }
  }
};
