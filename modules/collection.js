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
Cu.import("resource://snowl/modules/log4moz.js");
Cu.import("resource://snowl/modules/URI.js");

// modules that are Snowl-specific
Cu.import("resource://snowl/modules/constants.js");
Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/identity.js");
Cu.import("resource://snowl/modules/message.js");
Cu.import("resource://snowl/modules/service.js");
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

        let author;
        if (statement.row.authorID) {
          let person = new SnowlPerson(statement.row.people_id,
                                       statement.row.people_name,
                                       statement.row.people_placeID,
                                       statement.row.people_homeURL,
                                       statement.row.people_iconURL);
          let identity = new SnowlIdentity(statement.row.identities_id,
                                           statement.row.identities_sourceID,
                                           statement.row.identities_externalID,
                                           person);
          author = identity;
        }

        message = new SnowlMessage({
          id:         statement.row.messageID,
          source:     SnowlService.sourcesByID[statement.row.sourceID],
          externalID: statement.row.externalID,
          subject:    statement.row.subject,
          author:     author,
          timestamp:  SnowlDateUtils.julianToJSDate(statement.row.timestamp),
          received:   SnowlDateUtils.julianToJSDate(statement.row.received),
          link:       statement.row.link ? URI.get(statement.row.link) : null,
          current:    statement.row.current,
          read:       statement.row.read,
          headers:    JSON.parse(statement.row.headers),
          attributes: JSON.parse(statement.row.attributes),
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
    this.constraints = [];
    this._messages = [];
    this._messageIndex = {};
  },

  _generateStatement: function() {
    let columns = [
      "messages.id AS messageID",
      "messages.sourceID",
      "messages.externalID",
      "messages.subject",
      "messages.authorID",
      "messages.subject",
      "messages.timestamp",
      "messages.received",
      "messages.link",
      "messages.current",
      "messages.read",
      "messages.headers",
      "messages.attributes",
      "identities.id AS identities_id",
      "identities.sourceID AS identities_sourceID",
      "identities.externalID AS identities_externalID",
      "identities.personID AS identities_personID",
      "people.id AS people_id",
      "people.name AS people_name",
      "people.placeID AS people_placeID",
      "people.homeURL AS people_homeURL",
      "people.iconURL AS people_iconURL"
    ];

    if (this.groupIDColumn) {
      columns.push(this.groupIDColumn + " AS groupID");
      columns.push(this.groupNameColumn + " AS groupName");
    }

    let query = 
      "SELECT " + columns.join(", ") + " FROM sources " +
      "JOIN messages ON sources.id = messages.sourceID " +
      "LEFT JOIN identities ON messages.authorID = identities.id " +
      "LEFT JOIN people ON identities.personID = people.id ";

    let conditions = [], operator;

    for each (let condition in this.constraints) {
      operator = condition.operator ? condition.operator : "AND";
      if (conditions.length == 0)
        conditions.push(" WHERE (");
      else
        conditions.push(operator);
      if (condition.type == "ARRAY")
        // Cannot bind parameterize an array within a statement, do not be limited
        // to sqlite default 999 parms limit.
        conditions.push(condition.expression + " (" + condition.parameters + ")")
      else
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
      if (condition.type != "ARRAY")
        for (let [name, value] in Iterator(condition.parameters)) {
          statement.params[name] = value;
this._log.info("_generateStatement: name:value - "+name+" : "+value.toString());
this._log.info("_generateStatement: params - "+statement.params[name]);
      }

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

    // Secondary sort on AZ date.
    // XXX Implement multicolumn sort.
    if (properties[properties.length - 1] != "timestamp")
      properties.push("timestamp");

    let compare = function(a, b) {
      for each (let property in properties) {
        let x, y;
        let props = property.split(".");

        for (let i = 0; i < props.length; i++) {
          if (i == 0) {
            x = a[props[i]]
            y = b[props[i]];
          }
          else if (x && y) {
            x = x[props[i]];
            y = y[props[i]];
          }
        }

        if (prepareObjectForComparison(x) >
            prepareObjectForComparison(y))
          return 1 * order;
        if (prepareObjectForComparison(x) <
            prepareObjectForComparison(y))
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
