const EXPORTED_SYMBOLS = ["SnowlMessage"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/source.js");

function SnowlMessage(aID, aSubject, aAuthor, aLink, aTimestamp, aRead) {
  this.id = aID;
  this.subject = aSubject;
  this.author = aAuthor;
  this.link = aLink;
  this.timestamp = aTimestamp;
  this._read = aRead;
}

SnowlMessage.prototype = {
  id: null,
  subject: null,
  author: null,
  // FIXME: make this an nsIURI.
  link: null,
  timestamp: null,


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


  // FIXME: also store and make available the summary.

  get _contentStatement() {
    let statement = SnowlDatastore.createStatement(
      "SELECT content, contentType FROM parts WHERE messageID = :messageID"
    );
    this.__defineGetter__("_contentStatement", function() { return statement });
    return this._contentStatement;
  },

  _content: null,

  get content() {
    if (this._content)
      return this._content;

    try {
      this._contentStatement.params.messageID = this.id;
      if (this._contentStatement.step()) {
        this._content = Cc["@mozilla.org/feed-textconstruct;1"].
                        createInstance(Ci.nsIFeedTextConstruct);
        this._content.text = this._contentStatement.row.content;
        this._content.type = textConstructTypes[this._contentStatement.row.contentType];
      }
    }
    finally {
      this._contentStatement.reset();
    }

    return this._content;
  },

  set content(newValue) {
    this._content = newValue;
  },

  get _sourceStatement() {
    let statement = SnowlDatastore.createStatement(
      "SELECT sources.id, sources.url, sources.title " +
      "FROM messages JOIN sources ON messages.sourceID = sources.id " +
      "WHERE messages.id = :messageID"
    );
    this.__defineGetter__("_sourceStatement", function() { return statement });
    return this._sourceStatement;
  },

  _source: null,

  get source() {
    if (!this._source) {
      try {
        this._sourceStatement.params.messageID = this.id;
        if (this._sourceStatement.step())
          // FIXME: get this from the snowl service and make the service cache
          // sources so we don't create a new instance of the source object
          // for every message.
          this._source = new SnowlSource(this._sourceStatement.row.id,
                                         this._sourceStatement.row.url,
                                         this._sourceStatement.row.title);
      }
catch(ex) {
  dump(ex + "\n");
}
      finally {
        this._sourceStatement.reset();
      }
    }

    return this._source;
  }

};

let textConstructTypes = {
  "text/html": "html",
  "application/xhtml+xml": "xhtml",
  "text/plain": "text"
};
