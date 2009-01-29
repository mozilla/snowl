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

function SnowlMessage(props) {
  // The way this currently works requires instantiators to pass the value
  // of the read property via its private name _read, which seems wrong.
  // FIXME: make it so callers can pass read via its public name.
  for (let name in props)
    this[name] = props[name];
}

// FIXME: refactor this with the similar code in the SnowlCollection::messages getter.
// FIXME: retrieve an author object instead of just specific properties of the author.
// FIXME: retrieve all basic properties of the message in a single query.
SnowlMessage.get = function(id) {
  let message;

  let statement = SnowlDatastore.createStatement(
    "SELECT sourceID, subject, authors.name AS author, link, timestamp, read, " +
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
        author:     statement.row.author,
        authorID:   statement.row.authorID,
        link:       statement.row.link,
        timestamp:  SnowlDateUtils.julianToJSDate(statement.row.timestamp),
        _read:      (statement.row.read ? true : false),
        authorIcon: statement.row.authorIcon,
        received:   SnowlDateUtils.julianToJSDate(statement.row.received)
      });
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

  get source() {
    return SnowlService.sourcesByID[this.sourceID];
  }

};
