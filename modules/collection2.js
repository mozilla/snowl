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
 * Portions created by the Initial Developer are Copyright (C) 2009
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

let EXPORTED_SYMBOLS = ["Collection2"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

// modules that are generic
Cu.import("resource://snowl/modules/URI.js");
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/Sync.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/constants.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/message.js");
Cu.import("resource://snowl/modules/service.js");
Cu.import("resource://snowl/modules/utils.js");

Sync(Function);

/**
 * A set of messages.  Use this to retrieve messages from the datastore.
 * This implementation differs from the one in collection.js in that it:
 *   * doesn't support grouping;
 *   * queries asynchronously;
 *   * retrieves messages as complete objects;
 *   * provides a custom iterator.
 *
 * To use this object, create a new instance, passing the constructor
 * the criteria that define the set of objects to retrieve.  The constructor
 * will retrieve messages without blocking execution of events on the same
 * thread, although the call will appear synchronous to the caller.
 *
 *   let collection = new Collection2();
 *   for each (let message in collection)
 *     dump("retrieved message " + message.id + "\n");
 */
function Collection2() {
  this.execute.syncBind(this)();
}

Collection2.prototype = {
  //**************************************************************************//
  // Shortcuts

  get _log() {
    let log = Log4Moz.repository.getLogger("Snowl.Collection2");
    this.__defineGetter__("_log", function() log);
    return this._log;
  },

  execute: function(callback) {
    this._callback = callback;
    this._pendingStatement =
      this._statement._statement.statement.executeAsync(this);
    this._log.info("pending statement: " + this._pendingStatement);
  },


  //**************************************************************************//
  // mozIStorageStatementCallback

  handleResult: function(resultSet) {
    this._log.info("handleResult: " + resultSet);
    this._resultSet = resultSet;
  },
  
  handleError: function(error) {
    this._log.info("handleError: " + error);
  },

  handleCompletion: function(reason) {
    this._log.info("handleCompletion: " + reason);
    (this._callback)();
  },


  get _statement() {
    let columns = [
      "messages.id AS messageID",
      "messages.sourceID",
      "messages.authorID",
      "messages.subject",
      "messages.link",
      "messages.timestamp",
      "messages.read",
      "messages.received",
      "authors.name AS authorName",
      "authors.iconURL AS authorIcon",
      "parts.id AS partID",
      "parts.content",
      "parts.mediaType",
      "parts.baseURI",
      "parts.languageTag"
    ];

    let query = 
      "SELECT " + columns.join(", ") + " " +
      "FROM sources JOIN messages ON sources.id = messages.sourceID " +
      "LEFT JOIN people AS authors ON messages.authorID = authors.id " +
      "LEFT JOIN parts AS parts ON messages.id = parts.messageID " +

      // This partType condition has to be in the constraint for the LEFT JOIN
      // to the parts table because if it was in the WHERE clause it would
      // exclude messages without a content part, whereas we want to retrieve
      // all messages whether or not they have a content part.
      "AND parts.partType = " + PART_TYPE_CONTENT;

    this._log.info(query);

    let statement = SnowlDatastore.createStatement(query);

    return statement;
  },


  /**
   * An iterator across the messages in the collection.  Allows callers
   * to iterate messages via |for each... in|, i.e.:
   *
   *   let collection = new Collection2();
   *   for each (let message in collection) ...
   */
  __iterator__: function(wantKeys) {
    let row;
    while ((row = this._resultSet.getNextRow())) {
      let content = null;
      if (row.getResultByName("partID")) {
        content = Cc["@mozilla.org/feed-textconstruct;1"].
                  createInstance(Ci.nsIFeedTextConstruct);
        content.text = row.getResultByName("content");
        content.type = TEXT_CONSTRUCT_TYPES[row.getResultByName("mediaType")];
        content.base = URI.get(row.getResultByName("baseURI"));
        content.lang = row.getResultByName("languageTag");
      }

      let message = new SnowlMessage({
        id:         row.getResultByName("messageID"),
        sourceID:   row.getResultByName("sourceID"),
        source:     SnowlService.sourcesByID[row.getResultByName("sourceID")],
        subject:    row.getResultByName("subject"),
        authorName: row.getResultByName("authorName"),
        authorID:   row.getResultByName("authorID"),
        link:       row.getResultByName("link"),
        timestamp:  SnowlDateUtils.julianToJSDate(row.getResultByName("timestamp")),
        read:       row.getResultByName("read"),
        authorIcon: row.getResultByName("authorIcon"),
        received:   SnowlDateUtils.julianToJSDate(row.getResultByName("received")),
        content:    content
      });

      yield message;
    }
  }

};
