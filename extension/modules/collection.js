const EXPORTED_SYMBOLS = ["SnowlCollection"];

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

Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/message.js");
Cu.import("resource://snowl/modules/URI.js");

/**
 * A group of messages.
 */
function SnowlCollection(aSourceID, aFilter, aCurrent, aRead) {
  this._sourceID = aSourceID;
  this._filter = aFilter;
  this._current = aCurrent;
  this._read = aRead;
}

SnowlCollection.prototype = {
  get _log() {
    let log = Log4Moz.Service.getLogger("Snowl.Collection");
    this.__defineGetter__("_log", function() { return log });
    return this._log;
  },

  _sourceID: null,

  get sourceID() {
    return this._sourceID;
  },

  set sourceID(newVal) {
    if (this._sourceID == newVal)
      return;

    this._sourceID = newVal;
    this.invalidate();
  },

  _filter: null,

  get filter() {
    return this._filter;
  },

  set filter(newVal) {
    if (this._filter == newVal)
      return;

    this._filter = newVal;
    this.invalidate();
  },

  _current: undefined,

  get current() {
    return this._current;
  },

  set current(newValue) {
    if (this._current === newValue)
      return;

    this._current = (typeof newValue == "undefined") ? undefined : newValue ? true : false;

    // Invalidate the message cache.
    this._messages = null;
  },

  _read: undefined,

  get read() {
    return this._read;
  },

  set read(newValue) {
    if (this._read === newValue)
      return;

    this._read = (typeof newValue == "undefined") ? undefined : newValue ? true : false;

    // Invalidate the message cache.
    this._messages = null;
  },

  sortProperty: "timestamp",
  sortOrder: 1,

  _messages: null,

  get messages() {
    if (this._messages)
      return this._messages;

    this._messages = [];
    this._messageIndex = {};

    let statement = this._generateStatement();
    try {
      while (statement.step()) {
        let message = new SnowlMessage(statement.row.id,
                                       statement.row.subject,
                                       statement.row.author,
                                       statement.row.link,
                                       statement.row.timestamp,
                                       (statement.row.read ? true : false));
        this._messages.push(message);
        this._messageIndex[message.id] = message;
      }
    }
    finally {
      statement.reset();
    }

    this.sort(this.sortProperty, this.sortOrder);

    // A bug in SQLite breaks relating a virtual table via a LEFT JOIN, so we
    // can't pull content with our initial query.  Instead we do it here.
    // FIXME: stop doing this once we upgrade to a version of SQLite that does
    // not have this problem (i.e. 3.5.6+).
    this._getContent();

    this._log.info("Retrieved " + this._messages.length + " messages.");

    return this._messages;
  },

  invalidate: function() {
    this._messages = null;
  },

  _getContent: function() {
    let query = "SELECT messageID, content, mediaType, baseURI, languageCode " +
                "FROM parts WHERE partType = " + PART_TYPE_CONTENT +
                " AND messageID IN (" +
                  this._messages.map(function(v) { return v.id }).join(",") +
                ")";
    let statement = SnowlDatastore.createStatement(query);

    try {
      while (statement.step()) {
        let content = Cc["@mozilla.org/feed-textconstruct;1"].
                      createInstance(Ci.nsIFeedTextConstruct);
        content.text = statement.row.content;
        content.type = textConstructTypes[statement.row.mediaType];
        content.base = URI.get(statement.row.baseURI);
        content.lang = statement.row.languageCode;
        this._messageIndex[statement.row.messageID].content = content;
      }
    }
    finally {
      statement.reset();
    }
  },

  _generateStatement: function() {
    let query = 
      //"SELECT subject, author, link, timestamp, content \
      // FROM sources JOIN messages ON sources.id = messages.sourceID \
      // LEFT JOIN parts on messages.id = parts.messageID";
      "SELECT messages.id, subject, author, link, timestamp, read " +
      "FROM sources JOIN messages ON sources.id = messages.sourceID";

    let conditions = [];

    if (this.sourceID)
      conditions.push("messages.sourceID = :sourceID");

    // FIXME: use a left join here once the SQLite bug breaking left joins to
    // virtual tables has been fixed (i.e. after we upgrade to SQLite 3.5.7+).
    if (this.filter)
      conditions.push("messages.id IN (SELECT messageID FROM parts WHERE content MATCH :filter)");

    if (typeof this.current != "undefined")
      conditions.push("current = " + (this.current ? "1" : "0"));

    if (typeof this.read != "undefined")
      conditions.push("read = " + (this.read ? "1" : "0"));

    if (conditions.length > 0)
      query += " WHERE " + conditions.join(" AND ");

    this._log.info(query);

    let statement = SnowlDatastore.createStatement(query);

    if (this.sourceID)
      statement.params.sourceID = this.sourceID;

    if (this.filter)
      statement.params.filter = this.filter;

    return statement;
  },

  sort: function(aProperty, aOrder) {
    this.sortProperty = aProperty;
    this.sortOrder = aOrder;

    let compare = function(a, b) {
      if (prepareObjectForComparison(a[aProperty]) >
          prepareObjectForComparison(b[aProperty]))
        return 1 * aOrder;
      if (prepareObjectForComparison(a[aProperty]) <
          prepareObjectForComparison(b[aProperty]))
        return -1 * aOrder;

      // Fall back on the "subject" aProperty.
      if (aProperty != "subject") {
        if (prepareObjectForComparison(a.subject) >
            prepareObjectForComparison(b.subject))
          return 1 * aOrder;
        if (prepareObjectForComparison(a.subject) <
            prepareObjectForComparison(b.subject))
          return -1 * aOrder;
      }

      // Return an inconclusive result.
      return 0;
    };

    this._messages.sort(compare);
  }
}

function prepareObjectForComparison(aObject) {
  if (typeof aObject == "string")
    return aObject.toLowerCase();

  // Null values are neither greater than nor less than strings, so we
  // convert them into empty strings, which is how they appear to users.
  if (aObject == null)
    return "";

  return aObject;
}
