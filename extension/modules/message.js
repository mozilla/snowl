const EXPORTED_SYMBOLS = ["SnowlMessage"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://snowl/modules/datastore.js");

function SnowlMessage(aID, aSubject, aAuthor, aLink, aTimestamp, aRead) {
  this.id = aID;
  this.subject = aSubject;
  this.author = aAuthor;
  this.link = aLink;
  this.timestamp = aTimestamp;
  this.read = aRead;
}

SnowlMessage.prototype = {
  id: null,
  subject: null,
  author: null,
  // FIXME: make this an nsIURI.
  link: null,
  timestamp: null,
  read: null,

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
    if (this._content) {
      dump(this.id + " has content " + this._content.type + " " + this._content.text.length + "\n");
      return this._content;
    }

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
  }

};

let textConstructTypes = {
  "text/html": "html",
  "application/xhtml+xml": "xhtml",
  "text/plain": "text"
};
