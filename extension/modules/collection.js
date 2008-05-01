const EXPORTED_SYMBOLS = ["SnowlCollection"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://snowl/modules/message.js");

/**
 * A group of messages.
 */
function SnowlCollection(aSourceID, aFilter) {
  this.sourceID = aSourceID;
  this.filter = aFilter;
}

SnowlCollection.prototype = {
  sourceID: null,
  filter: null,

  sortProperty: "timestamp",
  sortOrder: 1,

  _messages: null,

  get messages() {
    if (this._messages)
      return this._messages;

    this._messages = [];

    let statement = this._generateStatement();
    try {
      while (statement.step())
        this._messages.push(
          new SnowlMessage(statement.row.id,
                           statement.row.subject,
                           statement.row.author,
                           statement.row.link,
                           statement.row.timestamp,
                           (statement.row.read ? true : false)));
    }
    finally {
      statement.reset();
    }

    this._sort();

    return this._messages;
  },

  _generateStatement: function() {
    let query = 
      //"SELECT sources.title AS sourceTitle, subject, author, link, timestamp, content \
      // FROM sources JOIN messages ON sources.id = messages.sourceID \
      // LEFT JOIN parts on messages.id = parts.messageID";
      "SELECT sources.title AS sourceTitle, messages.id AS id, " +
             "subject, author, link, timestamp, read " +
      "FROM sources JOIN messages ON sources.id = messages.sourceID";

    let conditions = [];

    if (this.sourceID)
      conditions.push("messages.sourceID = :sourceID");

    // FIXME: use a left join here once the SQLite bug breaking left joins to
    // virtual tables has been fixed (i.e. after we upgrade to SQLite 3.5.7+).
    if (this.filter)
      conditions.push("messages.id IN (SELECT messageID FROM parts WHERE content MATCH :filter)");

    if (conditions.length > 0)
      query += " WHERE " + conditions.join(" AND ");

    let statement = SnowlDatastore.createStatement(query);

    if (this.sourceID)
      statement.params.sourceID = this.sourceID;

    if (this.filter)
      statement.params.filter = this.filter;

    return statement;
  },

  _sort: function() {
    let property = this.sortProperty;
    let order = this.sortOrder;

    let compare = function(a, b) {
      if (prepareObjectForComparison(a[property]) >
          prepareObjectForComparison(b[property]))
        return 1 * order;
      if (prepareObjectForComparison(a[property]) <
          prepareObjectForComparison(b[property]))
        return -1 * order;

      // Fall back on the "subject" property.
      if (property != "subject") {
        if (prepareObjectForComparison(a.subject) >
            prepareObjectForComparison(b.subject))
          return 1 * order;
        if (prepareObjectForComparison(a.subject) <
            prepareObjectForComparison(b.subject))
          return -1 * order;
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
