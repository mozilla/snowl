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

SnowlIdentity.create = function(sourceID, externalID, name) {
  let identity;

  let personStatement = SnowlDatastore.createStatement(
    "INSERT INTO people (name) VALUES (:name)"
  );

  let identityStatement = SnowlDatastore.createStatement(
    "INSERT INTO identities (sourceID, externalID, personID) " +
    "VALUES (:sourceID, :externalID, :personID)"
  );

  try {
    personStatement.params.name = name;
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

function SnowlPerson(id, name) {
  this.id = id;
  this.name = name;
}

SnowlPerson.__defineGetter__("_getAllStatement",
  function() {
    let statement = SnowlDatastore.createStatement(
      "SELECT id, name FROM people ORDER BY name"
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
      people.push(new SnowlPerson(statement.row.id, statement.row.name));
  }
  finally {
    statement.reset();
  }

  return people;
}
