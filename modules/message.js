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

// modules that are generic
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
// FIXME: retrieve an author object instead of just specific properties of the author.
// FIXME: retrieve all basic properties of the message in a single query.
// FIXME: retrieve multiple messages in a single query.
SnowlMessage.retrieve = function(id) {
  let message;

  // FIXME: memoize this.
  let statement = SnowlDatastore.createStatement(
    "SELECT sourceID, subject, authors.name AS authorName, link, timestamp, read, " +
    "       authors.iconURL AS authorIcon, received, authorID " +
    "FROM messages LEFT JOIN people AS authors ON messages.authorID = authors.id " +
    "WHERE messages.id = :id"
  );

  try {
    statement.params.id = id;
    if (statement.step()) {
      message = new SnowlMessage({
        id:         id,
        sourceID:   statement.row.sourceID,
        subject:    statement.row.subject,
        authorName: statement.row.authorName,
        authorID:   statement.row.authorID,
        link:       statement.row.link ? URI.get(statement.row.link) : null,
        timestamp:  SnowlDateUtils.julianToJSDate(statement.row.timestamp),
        read:       statement.row.read,
        authorIcon: statement.row.authorIcon,
        received:   SnowlDateUtils.julianToJSDate(statement.row.received)
      });

      message.author = SnowlIdentity.retrieve(message.authorID);
    }
  }
  finally {
    statement.reset();
  }

  return message;
};

SnowlMessage.prototype = {
  id: null,
  externalID: null,
  subject: null,
  authorName: null,
  authorID: null,
  author: null,
  link: null,
  timestamp: null,
  received: null,
  read: false,

  /**
   * The content of the message.  If undefined, we haven't retrieved it from
   * the datastore.  If null, on the other hand, the message has no content.
   */
  _content: undefined,
  get content() {
    if (typeof this._content == "undefined")
      this._content = this._getPart(PART_TYPE_CONTENT);
    return this._content;
  },
  set content(newValue) {
    this._content = newValue;
  },

  /**
   * The summary of the message.  If undefined, we haven't retrieved it from
   * the datastore.  If null, on the other hand, the message has no summary.
   */
  _summary: undefined,
  get summary() {
    if (typeof this._summary == "undefined")
      this._summary = this._getPart(PART_TYPE_SUMMARY);
    return this._summary;
  },
  set summary(newValue) {
    this._summary = newValue;
  },

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

  get source() {
    return SnowlService.sourcesByID[this.sourceID];
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

    this.author.persist();

    this._stmtInsertMessage.params.sourceID   = this.sourceID;
    this._stmtInsertMessage.params.externalID = this.externalID;
    this._stmtInsertMessage.params.subject    = this.subject;
    this._stmtInsertMessage.params.authorID   = this.author.id;
    this._stmtInsertMessage.params.timestamp  = SnowlDateUtils.jsToJulianDate(this.timestamp);
    this._stmtInsertMessage.params.received   = SnowlDateUtils.jsToJulianDate(this.received);
    this._stmtInsertMessage.params.link       = this.link ? this.link.spec : null;
    this._stmtInsertMessage.params.read       = this.read;
    this._stmtInsertMessage.execute();

    this.id = SnowlDatastore.dbConnection.lastInsertRowID;

    if (this.content)
      this.content.persist(this);
    if (this.summary)
      this.summary.persist(this);

    return this.id;
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
};
