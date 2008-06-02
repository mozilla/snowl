const EXPORTED_SYMBOLS = ["SnowlMessage"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

// FIXME: factor this out into a common file.
const PART_TYPE_CONTENT = 1;
const PART_TYPE_SUMMARY = 2;

// Media type to nsIFeedTextConstruct::type mappings.
// FIXME: get this from message.js (or from something that both message.js
// and collection.js import).
const textConstructTypes = {
  "text/html": "html",
  "application/xhtml+xml": "xhtml",
  "text/plain": "text"
};

Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/source.js");
Cu.import("resource://snowl/modules/URI.js");

function SnowlMessage(aID, aSubject, aAuthor, aLink, aTimestamp, aRead) {
  this.id = aID;
  this.subject = aSubject;
  this.author = aAuthor;
  this.link = aLink;
  this.timestamp = aTimestamp;
  this._read = aRead;
}

SnowlMessage.get = function(aID) {
  let message;

  let statement = SnowlDatastore.createStatement(
    "SELECT subject, author, link, timestamp, read FROM messages WHERE id = :id"
  );

  try {
    statement.params.id = aID;
    if (statement.step()) {
      message = new SnowlMessage(aID,
                                 statement.row.subject,
                                 statement.row.author,
                                 statement.row.link,
                                 statement.row.timestamp,
                                 (statement.row.read ? true : false));
    }
  }
  finally {
    statement.reset();
  }

  return message;
};

SnowlMessage.prototype = {
  id: null,
  subject: null,
  author: null,
  // FIXME: make this an nsIURI.
  link: null,
  timestamp: null,

  // FIXME: figure out whether or not setters should update the database.

  _read: undefined,

  get read() {
    return this._read;
  },

  set read(newValue) {
    if (this._read == newValue)
      return;
    this._read = newValue ? true : false;
    SnowlDatastore.dbConnection.executeSimpleSQL("UPDATE messages SET read = " +
                                                 (this._read ? "1" : "0") +
                                                 " WHERE id = " + this.id);
  },

  _content: null,
  get content() {
    if (!this._content)
      this._content = this._getPart(PART_TYPE_CONTENT);
    return this._content;
  },
  set content(newValue) {
    this._content = newValue;
  },

  _summary: null,
  get summary() {
    if (!this._summary)
      this._summary = this._getPart(PART_TYPE_SUMMARY);
    return this._summary;
  },
  set summary(newValue) {
    this._summary = newValue;
  },

  get _getPartStatement() {
    let statement = SnowlDatastore.createStatement(
      "SELECT content, mediaType, baseURI, languageCode FROM parts " +
      "WHERE messageID = :messageID AND partType = :partType"
    );
    this.__defineGetter__("_getPartStatement", function() { return statement });
    return this._getPartStatement;
  },

  _getPart: function(aPartType) {
    let part;

    try {
      this._getPartStatement.params.messageID = this.id;
      this._getPartStatement.params.partType = aPartType;
      if (this._getPartStatement.step()) {
        // FIXME: instead of a text construct, return a JS object that knows
        // its ID and part type.
        part = Cc["@mozilla.org/feed-textconstruct;1"].
               createInstance(Ci.nsIFeedTextConstruct);
        part.text = this._getPartStatement.row.content;
        part.type = textConstructTypes[this._getPartStatement.row.mediaType];
        part.base = URI.get(this._getPartStatement.row.baseURI);
        part.lang = this._getPartStatement.row.languageCode;
      }
    }
    finally {
      this._getPartStatement.reset();
    }

    return part;
  },

  // FIXME: for performance, make this a class property rather than an instance
  // property?
  get _getSourceIDStatement() {
    let statement = SnowlDatastore.createStatement(
      "SELECT sourceID FROM messages WHERE id = :id"
    );
    this.__defineGetter__("_getSourceIDStatement", function() { return statement });
    return this._getSourceIDStatement;
  },

  get source() {
    if (!this._source) {
      try {
        this._getSourceIDStatement.params.id = this.id;
        if (this._getSourceIDStatement.step())
          this._source = SnowlSource.get(this._getSourceIDStatement.row.sourceID);
      }
      finally {
        this._getSourceIDStatement.reset();
      }
    }

    return this._source;
  }

};
