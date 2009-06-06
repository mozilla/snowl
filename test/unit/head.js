const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

function deleteDatabase() {
  Cu.import("resource://snowl/modules/datastore.js");
  SnowlDatastore.finalizeStatements();
  let databaseFile = SnowlDatastore.dbConnection.databaseFile;
  SnowlDatastore.dbConnection.close();
  databaseFile.remove(false);
}
