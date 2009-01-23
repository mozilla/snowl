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

const EXPORTED_SYMBOLS = ["SnowlIdentity", "SnowlPerson"];

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

Cu.import("resource://snowl/modules/datastore.js");
Cu.import("resource://snowl/modules/source.js");
Cu.import("resource://snowl/modules/URI.js");

function SnowlIdentity(id, sourceID, externalID, personID) {
  this.id = id;
  this.sourceID = sourceID;
  this.externalID = externalID;
  this.personID = personID;
}

SnowlIdentity.get = function(sourceID, externalID) {
  let identity;

  let statement = SnowlDatastore.createStatement(
    "SELECT id, personID FROM identities WHERE externalID = :externalID AND sourceID = :sourceID"
  );

  try {
    statement.params.sourceID = sourceID;
    statement.params.externalID = externalID;
    if (statement.step()) {
      identity = new SnowlIdentity(statement.row.id, sourceID, externalID, statement.row.personID);
    }
  }
  finally {
    statement.reset();
  }

  return identity;
};

SnowlIdentity.create = function(sourceID, externalID, name, homeURL, iconURL) {
  let identity;

  let personStatement = SnowlDatastore.createStatement(
    "INSERT INTO people (name, homeURL, iconURL) VALUES (:name, :homeURL, :iconURL)"
  );

  let identityStatement = SnowlDatastore.createStatement(
    "INSERT INTO identities (sourceID, externalID, personID) " +
    "VALUES (:sourceID, :externalID, :personID)"
  );

  try {
    personStatement.params.name = name;
    personStatement.params.homeURL = homeURL || null;
    personStatement.params.iconURL = iconURL || null;
    personStatement.step();
    let personID = SnowlDatastore.dbConnection.lastInsertRowID;

    identityStatement.params.sourceID = sourceID;
    identityStatement.params.externalID = externalID;
    identityStatement.params.personID = personID;
    identityStatement.step();
    let identityID = SnowlDatastore.dbConnection.lastInsertRowID;

    identity = new SnowlIdentity(identityID, sourceID, externalID, personID);
  }
  finally {
    personStatement.reset();
    identityStatement.reset();
  }

  return identity;
};

SnowlIdentity.prototype = {};

function SnowlPerson(id, name, placeID) {
  this.id = id;
  this.name = name;
  this.placeID = placeID;
}

SnowlPerson.__defineGetter__("_getAllStatement",
  function() {
    let statement = SnowlDatastore.createStatement(
      "SELECT id, name, placeID FROM people ORDER BY name"
    );
    this.__defineGetter__("_getAllStatement", function() { return statement });
    return this._getAllStatement;
  }
);

SnowlPerson.getAll = function() {
  let people = [];

  let statement = this._getAllStatement;

  try {
    while (statement.step())
      people.push(new SnowlPerson(statement.row.id,
                                  statement.row.name,
                                  statement.row.placeID));
  }
  finally {
    statement.reset();
  }

  return people;
}
