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

let EXPORTED_SYMBOLS = ["SnowlMessage"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

// modules that are generic
Cu.import("resource://snowl/modules/URI.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/constants.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/service.js");
Cu.import("resource://snowl/modules/source.js");
Cu.import("resource://snowl/modules/utils.js");

function SnowlMessage(aID, aSubject, aAuthor, aLink, aTimestamp, aRead, aAuthorIcon, aReceived) {
  this.id = aID;
  this.subject = aSubject;
  this.author = aAuthor;
  this.link = aLink;
  this.timestamp = aTimestamp;
  this._read = aRead;
  this.authorIcon = aAuthorIcon;
  this.received = aReceived;
}

SnowlMessage.get = function(aID) {
  let message;

  let statement = SnowlDatastore.createStatement(
    "SELECT subject, authors.name AS author, link, timestamp, read, " +
    "       authors.iconURL AS authorIcon, received " +
    "FROM messages LEFT JOIN people AS authors ON messages.authorID = authors.id " +
    "WHERE messages.id = :id"
  );

  try {
    statement.params.id = aID;
    if (statement.step()) {
      message = new SnowlMessage(aID,
                                 statement.row.subject,
                                 statement.row.author,
                                 statement.row.link,
                                 SnowlDateUtils.julianToJSDate(statement.row.timestamp),
                                 (statement.row.read ? true : false),
                                 statement.row.authorIcon,
                                 SnowlDateUtils.julianToJSDate(statement.row.received));
    }
    else {
      // Message not there, create structure anyway
      message = new SnowlMessage(null,
                                 null,
                                 null,
                                 null,
                                 null,
                                 null,
                                 null,
                                 null);
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
  received: null,

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
        part.type = TEXT_CONSTRUCT_TYPES[this._getPartStatement.row.mediaType];
        part.base = URI.get(this._getPartStatement.row.baseURI);
        part.lang = this._getPartStatement.row.languageTag;
      }
    }
    finally {
      this._getPartStatement.reset();
    }

    return part;
  },

  _notfound: null,
  get notfound() {
    if (!this._notfound) {
      let part = Cc["@mozilla.org/feed-textconstruct;1"].
                 createInstance(Ci.nsIFeedTextConstruct);
      part.text = "notfound";
      part.type = "html";
      part.base = null;
      part.lang = null;
      this._notfound = part;
    }
    return this._notfound;
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
          this._source = SnowlService.getAccount(this._getSourceIDStatement.row.sourceID);
      }
      finally {
        this._getSourceIDStatement.reset();
      }
    }

    return this._source;
  },

};
