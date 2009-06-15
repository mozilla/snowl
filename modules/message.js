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
  for (let name in props)
    this[name] = props[name];
}

// FIXME: refactor this with the similar code in the SnowlCollection::messages getter.
// FIXME: retrieve multiple messages in a single query.
SnowlMessage.retrieve = function(id) {
  let message;

  // FIXME: memoize this.
  let statement = SnowlDatastore.createStatement(
    "SELECT sourceID, externalID, subject, authorID, timestamp, received, link, current, read " +
    "FROM messages WHERE messages.id = :id"
  );

  try {
    statement.params.id = id;
    if (statement.step()) {
      message = new SnowlMessage({
        id:         id,
        source:     SnowlService.sourcesByID[statement.row.sourceID],
        externalID: statement.row.externalID,
        subject:    statement.row.subject,
        timestamp:  SnowlDateUtils.julianToJSDate(statement.row.timestamp),
        received:   SnowlDateUtils.julianToJSDate(statement.row.received),
        link:       statement.row.link ? URI.get(statement.row.link) : null,
        current:    statement.row.current,
        read:       statement.row.read ? true : false
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

  if (message) {
    message.summary = message._getPart(PART_TYPE_SUMMARY);
    message.content = message._getPart(PART_TYPE_CONTENT);
  }

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
  source: null,
  externalID: null,
  subject: null,
  author: null,
  link: null,
  timestamp: null,
  received: null,
  read: false,
  current: null,
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
      "SELECT id, content, mediaType, baseURI, languageTag FROM parts " +
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
        part = new SnowlMessagePart({ id:          this._getPartStatement.row.id,
                                      partType:    aPartType,
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

  get _insertMessageStmt() {
    // FIXME: persist message.current.
    let statement = SnowlDatastore.createStatement(
      "INSERT INTO messages " +
      "( sourceID,  externalID,  subject,  authorID,  timestamp,  received,  link,  " + /*current,  */ " read) " +
      "VALUES " +
      "(:sourceID, :externalID, :subject, :authorID, :timestamp, :received, :link, " + /*:current,  */ ":read)"
    );
    this.__defineGetter__("_insertMessageStmt", function() statement);
    return this._insertMessageStmt;
  },

  get _updateMessageStmt() {
    let statement = SnowlDatastore.createStatement(
      "UPDATE messages SET " +
      "sourceID = :sourceID, " +
      "externalID = :externalID, " +
      "subject = :subject, " +
      "authorID = :authorID, " +
      "timestamp = :timestamp, " +
      "received = :received, " +
      "link = :link, " +
      // FIXME: persist message.current.
      //"current = :current, " +
      "read = :read " +
      "WHERE id = :id"
    );
    this.__defineGetter__("_updateMessageStmt", function() statement);
    return this._updateMessageStmt;
  },

  /**
   * Persist the message to the messages table.
   *
   * @returns {integer} the ID of the newly-created record
   */
  persist: function() {
    let added = false;

    // The message might already be stored, even if we don't have an ID for it
    // (we might have retrieved it from its source), so try to get its ID
    // from the datastore before storing it, so we know whether to create a new
    // record for it or update an existing one.
    if (!this.id) {
      this.id = this._getInternalID();

      // If this SnowlMessage instance doesn't have an ID (i.e. we've just
      // retrieved it from its source), but the message does exist in the
      // datastore, then override the default value of the read property
      // with its value in the datastore, so messages that have been marked
      // read don't get unmarked the next time we retrieve them.
      //
      // This is something of a hack; right now |read| is the only property
      // that we persist and restore that can change for an existing message,
      // and we have to override the default value with the persisted value
      // when persisting a message that we've just retrieved from its source.
      //
      // Perhaps we should distinguish between initial persistence of a new
      // message and updating of an existing message so we can apply different
      // rules in those two situations, although there's still the difficult
      // question of what those rules are.
      //
      if (this.id)
        this.read = this._getRead();
    }

    if (this.author)
      this.author.persist();

    // Determine whether to update an existing record or create a new one,
    // and set any params that are specific to the type of query we execute.
    let statement;
    if (this.id) {
      statement = this._updateMessageStmt;
      statement.params.id = this.id;
    }
    else {
      statement = this._insertMessageStmt;
    }

    // Set params that are common to both types of queries.
    statement.params.sourceID   = this.source.id;
    statement.params.externalID = this.externalID;
    statement.params.subject    = this.subject;
    statement.params.authorID   = this.author ? this.author.id : null;
    statement.params.timestamp  = SnowlDateUtils.jsToJulianDate(this.timestamp);
    statement.params.received   = SnowlDateUtils.jsToJulianDate(this.received);
    statement.params.link       = this.link ? this.link.spec : null;
    // FIXME: persist message.current.
    //statement.params.current    = this.current;
    statement.params.read       = this.read;

    statement.execute();

    if (this.id) {
      // FIXME: update the message parts (content, summary).
    }
    else {
      added = true;

      this.id = SnowlDatastore.dbConnection.lastInsertRowID;

      if (this.content)
        this.content.persist(this);
      if (this.summary)
        this.summary.persist(this);
    }

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

  get _getReadStmt() {
    let statement = SnowlDatastore.createStatement(
      "SELECT read FROM messages WHERE id = :id"
    );
    this.__defineGetter__("_getReadStmt", function() statement);
    return this._getReadStmt;
  },

  /**
   * Get the read status of the message.
   *
   * @returns  {Boolean}
   *           the read status of the message
   */
  _getRead: function() {
    let read;

    try {
      this._getReadStmt.params.id = this.id;
      if (this._getReadStmt.step())
        read = this._getReadStmt.row.read;
    }
    finally {
      this._getReadStmt.reset();
    }

    return read;
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
    if (this.id) {
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
