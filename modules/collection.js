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
function SnowlCollection(id, name, iconURL, constraints, parent, grouped,
                         groupIDColumn, groupNameColumn, groupHomeURLColumn,
                         groupIconURLColumn, filters) {
  this.id = id;
  this.name = name;
  this.iconURL = iconURL;
  this.constraints = constraints || [];
  // XXX Does this create a cycle?
  this.parent = parent;
  this.grouped = grouped;
  this.groupIDColumn = groupIDColumn;
  this.groupNameColumn = groupNameColumn;
  this.groupHomeURLColumn = groupHomeURLColumn;
  this.groupIconURLColumn = groupIconURLColumn;
  this._filters = filters || [];
}

SnowlCollection.prototype = {
  get _log() {
    let log = Log4Moz.Service.getLogger("Snowl.Collection");
    this.__defineGetter__("_log", function() { return log });
    return this._log;
  },

  _filters: null,

  get filters() {
    return this._filters;
  },

  set filters(newVal) {
    this._filters = newVal;
    this.invalidate();
  },


  //**************************************************************************//
  // Grouping

  // XXX This stuff only matters when the collection is being displayed
  // in the sidebar.  Should we split it out to another class that subclasses
  // Collection or composes a new class with it?

  isOpen: false,
  level: 0,

  _groups: null,
  get groups() {
    if (!this.grouped)
      return null;

    if (this._groups)
      return this._groups;

    let groups = [];

    let statement = this._generateGetGroupsStatement();
    try {
      while (statement.step()) {
        let name = statement.row.name;

        let iconURL =
          statement.row.iconURL ? URI.get(statement.row.iconURL) :
          statement.row.homeURL ? this.getFaviconURL(URI.get(statement.row.homeURL))
                                : null;
        if (!iconURL && this.iconURL)
          iconURL = this.iconURL;
        // FIXME: fall back to a default collection icon.

        let constraints = [constraint for each (constraint in this.constraints)];
        constraints.push({ expression: this.groupNameColumn + " = :groupValue",
                           parameters: { groupValue: statement.row.name } });

        let group = new SnowlCollection(null, name, iconURL, constraints, this);

        group.level = this.level + 1;
        groups.push(group);
      }
    }
    finally {
      statement.reset();
    }

    this._log.info("got " + groups.length + " groups");

    return this._groups = groups;
  },

  _generateGetGroupsStatement: function() {
    let columns = [];

    // FIXME: add groupIDColumn and make groupNameColumn optional.
    columns.push("DISTINCT(" + this.groupNameColumn + ") AS name");

    // For some reason, trying to access statement.row.foo dies without throwing
    // an exception if foo isn't defined as a column in the query, so we have to
    // define iconURL and homeURL columns even if we don't use them.
    // FIXME: file a bug on this bizarre behavior.
    if (this.groupIconURLColumn)
      columns.push(this.groupIconURLColumn + " AS iconURL");
    else
      columns.push("NULL AS iconURL");

    if (this.groupHomeURLColumn)
      columns.push(this.groupHomeURLColumn + " AS homeURL");
    else
      columns.push("NULL AS homeURL");

    // FIXME: allow group queries to make people the primary table.

    let query = 
      "SELECT " + columns.join(", ") + " " +
      "FROM sources JOIN messages ON sources.id = messages.sourceID " +
      "LEFT JOIN people AS authors ON messages.authorID = authors.id";

    let conditions = [];

    for each (let condition in this.constraints)
      conditions.push(condition.expression);

    if (conditions.length > 0)
      query += " WHERE " + conditions.join(" AND ");

    query += " ORDER BY " + this.groupNameColumn;

    this._log.info(this.name + " group query: " + query);

    let statement = SnowlDatastore.createStatement(query);

    for each (let condition in this.constraints)
      for (let [name, value] in Iterator(condition.parameters))
        statement.params[name] = value;

    return statement;
  },

  // Favicon Service
  get _faviconSvc() {
    let faviconSvc = Cc["@mozilla.org/browser/favicon-service;1"].
                     getService(Ci.nsIFaviconService);
    delete this.__proto__._faviconSvc;
    this.__proto__._faviconSvc = faviconSvc;
    return this._faviconSvc;
  },

  getFaviconURL: function(homeURL) {
    try {
      return this._faviconSvc.getFaviconForPage(homeURL);
    }
    catch(ex) { /* no known favicon; use the default */ }

    return null;
  },


  //**************************************************************************//
  // Retrieval

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
      "SELECT messages.id, subject, authors.name AS author, link, timestamp, read " +
      "FROM sources JOIN messages ON sources.id = messages.sourceID " +
      "LEFT JOIN people AS authors ON messages.authorID = authors.id";

    let conditions = [];

    for each (let condition in this.constraints)
      conditions.push(condition.expression);

    for each (let condition in this.filters)
      conditions.push(condition.expression);

    if (conditions.length > 0)
      query += " WHERE " + conditions.join(" AND ");

    this._log.info(query);

    let statement = SnowlDatastore.createStatement(query);

    for each (let condition in this.constraints)
      for (let [name, value] in Iterator(condition.parameters))
        statement.params[name] = value;

    for each (let condition in this.filters)
      for (let [name, value] in Iterator(condition.parameters))
        statement.params[name] = value;

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

    this.messages.sort(compare);
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
