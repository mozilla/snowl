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

let EXPORTED_SYMBOLS = ["SnowlCollection"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

// modules that are generic
Cu.import("resource://snowl/modules/URI.js");
Cu.import("resource://snowl/modules/log4moz.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/constants.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/message.js");
Cu.import("resource://snowl/modules/utils.js");

// FIXME: make SnowlCollection take a hash so it can have named parameters,
// since the number of parameters it currently accepts, and the fact that they
// are all optional, makes it unwieldy to pass them in the right order.

/**
 * A set of messages.
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

  this.sortProperties = ["timestamp"];
}

SnowlCollection.prototype = {
  get _log() {
    let log = Log4Moz.repository.getLogger("Snowl.Collection");
    this.__defineGetter__("_log", function() { return log });
    return this._log;
  },

  order: null,
  limit: null,

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
this._log.info("got group name: " + group.name);

        if (this.groupIDColumn)
          group.groupID = statement.row.groupID;

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

    if (this.groupIDColumn) {
      columns.push("DISTINCT(" + this.groupIDColumn + ") AS groupID");
      columns.push(this.groupNameColumn + " AS name");
    }
    else
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
      "FROM sources LEFT JOIN messages ON sources.id = messages.sourceID " +
      "LEFT JOIN people AS authors ON messages.authorID = authors.id";

    let conditions = [];

    for each (let condition in this.constraints)
      conditions.push(condition.expression);

    if (conditions.length > 0)
      query += " WHERE " + conditions.join(" AND ");

    query += " ORDER BY " + this.groupNameColumn + " COLLATE NOCASE";

    if (this.limit)
      query += " LIMIT " + this.limit;

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

  // sortProperties gets set to its default value in the constructor
  // since the default is an array, which would be a singleton if defined here.
  sortProperties: null,
  sortOrder: 1,

  _messages: null,

  get messages() {
    if (this._messages)
      return this._messages;

    this._messages = [];
    this._messageIndex = {};

    let statement = this._generateStatement();
    let content, message;
    try {
      while (statement.step()) {
        content = null;
        if (statement.row.partID) {
          content = Cc["@mozilla.org/feed-textconstruct;1"].
                    createInstance(Ci.nsIFeedTextConstruct);
          content.text = statement.row.content;
          content.type = TEXT_CONSTRUCT_TYPES[statement.row.mediaType];
          content.base = URI.get(statement.row.baseURI);
          content.lang = statement.row.languageTag;
        }

        message = new SnowlMessage({
          id:         statement.row.messageID,
          sourceID:   statement.row.sourceID,
          subject:    statement.row.subject,
          authorName: statement.row.authorName,
          authorID:   statement.row.authorID,
          link:       statement.row.link,
          timestamp:  SnowlDateUtils.julianToJSDate(statement.row.timestamp),
          _read:      (statement.row.read ? true : false),
          authorIcon: statement.row.authorIcon,
          received:   SnowlDateUtils.julianToJSDate(statement.row.received),
          content:    content
        });

        this._messages.push(message);
        this._messageIndex[message.id] = message;
      }
    }
    finally {
      statement.reset();
    }

    this._log.info("Retrieved " + this._messages.length + " messages.");

    return this._messages;
  },

  invalidate: function() {
    this._messages = null;
  },

  clear: function() {
    this._messages = [];
    this._messageIndex = {};
  },

  _generateStatement: function() {
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

    if (this.groupIDColumn) {
      columns.push(this.groupIDColumn + " AS groupID");
      columns.push(this.groupNameColumn + " AS groupName");
    }

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

    let conditions = [], operator;

    for each (let condition in this.constraints) {
      operator = condition.operator ? condition.operator : "AND";
      if (conditions.length == 0)
        conditions.push(" WHERE (");
      else
        conditions.push(operator);
      conditions.push(condition.expression);
    }
    if (conditions.length > 0)
      conditions.push(")");

    for each (let condition in this.filters) {
      operator = condition.operator ? condition.operator : "AND";
      if (conditions.length == 0)
        conditions.push(" WHERE");
      else
        conditions.push(operator);
      conditions.push(condition.expression);
    }

    if (conditions.length > 0)
      query += conditions.join(" ");

    if (this.order)
      query += " ORDER BY " + this.order;

    if (this.limit)
      query += " LIMIT " + this.limit;

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

  sort: function() {
    // Reflect these into local variables that the compare function closure
    // can access.
    let properties = this.sortProperties;
    let order = this.sortOrder;

    // Fall back on subject.
    // XXX Should we let callers make this decision?
    if (properties[properties.length - 1] != "subject")
      properties.push("subject");

    let compare = function(a, b) {
      for each (let property in properties) {
        if (prepareObjectForComparison(a[property]) >
            prepareObjectForComparison(b[property]))
          return 1 * order;
        if (prepareObjectForComparison(a[property]) <
            prepareObjectForComparison(b[property]))
          return -1 * order;
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
