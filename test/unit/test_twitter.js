// modules that come with Firefox

// modules that are generic
Cu.import("resource://snowl/modules/Observers.js");
Cu.import("resource://snowl/modules/URI.js");

// Snowl-specific modules
Cu.import("resource://snowl/modules/collection.js");
Cu.import("resource://snowl/modules/message.js");
Cu.import("resource://snowl/modules/twitter.js");
Cu.import("resource://snowl/modules/service.js");

let server, twitter;
let refreshTime = new Date();

function run_test() {
  server = new nsHttpServer();
  let basePath = do_get_file("test/unit/twitter/");
  server.registerDirectory("/", basePath);
  server.start(8080);

  do_test_pending();

  twitter = new SnowlTwitter(null, "snowl_test", new URI("http://localhost:8080/"));
  // FIXME: provide credentials { username: "snowl_test", password: "whatever" }
  twitter.username = "snowl_test";
  twitter.refresh(refreshTime, do_callback(finish_test));
}

function check_account(twitter) {
  do_check_eq(twitter.constructor.name, "SnowlTwitter");
  do_check_eq(twitter.name, "snowl_test");
  do_check_eq(twitter.machineURI.spec, "http://localhost:8080/");
  do_check_eq(twitter.humanURI.spec, "http://twitter.com/home");
  do_check_eq(twitter.username, "snowl_test");
  do_check_eq(twitter.lastRefreshed.getTime(), refreshTime.getTime());
  do_check_eq(twitter.importance, null);

  let messages = twitter.messages;
  do_check_eq(messages.length, 1);

  let message = messages[0];

  // Check the primitive attributes of the message object.
  do_check_eq(message.id.constructor.name, "Number");
  do_check_eq(message.sourceID, twitter.id);
  do_check_eq(message.subject, null);
  do_check_eq(message.link, null);
  do_check_eq(message.timestamp.getTime(), 1242332345000);
  do_check_eq(message.read, false);
  do_check_eq(message.received.getTime(), refreshTime.getTime());

  // Check the attributes of the message author.
  do_check_eq(message.author.id.constructor.name, "Number");
  do_check_eq(message.author.sourceID, twitter.id);
  do_check_eq(message.author.externalID, 55555);

  // Check the attributes of the person associated with the message author.
  do_check_eq(message.author.person.constructor.name, "Object");
  do_check_eq(message.author.person.id.constructor.name, "Number");
  do_check_eq(message.author.person.name, "nofx_test");
  do_check_eq(message.author.person.placeID.constructor.name, "Number");
  do_check_eq(message.author.person.homeURL, "http://www.nofxofficialwebsite.com/");
  do_check_eq(message.author.person.iconURL, "http://www.nofxofficialwebsite.com/images/index/index_02.gif");
  // FIXME: figure out how to check that this is correct.
  //do_check_eq(message.author.person.icon, null);

  // Check the message's content.
  do_check_true(message.content instanceof SnowlMessagePart);
  do_check_eq(message.content.text, "Or maybe, tear it apart, Start with assumption, That a million people are smart, Smarter than one!");
  do_check_eq(message.content.type, "text");
  do_check_eq(message.content.base, null);
  do_check_eq(message.content.lang, null);

  // Check the message's summary.
  do_check_eq(message.summary, null);
}

function finish_test() {
  let id = twitter.persist();
  do_check_eq(id, twitter.id);

  try {
  
    // Make sure the account is as expected both before and after retrieval.
    check_account(twitter);
    do_check_eq(id.constructor.name, "Number");
    do_check_eq(twitter.placeID.constructor.name, "Number");
    let twitter2 = SnowlTwitter.retrieve(id);
    check_account(twitter2);
    do_check_eq(twitter2.id, twitter.id);
    do_check_eq(twitter2.placeID, twitter.placeID);

    do_check_eq(SnowlService.accounts.length, 1);
    let account = SnowlService.accounts[0];
    do_check_eq(account.id.constructor.name, "Number");
    do_check_eq(account.constructor.name, "SnowlTwitter");
    do_check_eq(account.name, "snowl_test");
    do_check_eq(account.machineURI.spec, "http://localhost:8080/");
    do_check_eq(account.humanURI.spec, "http://twitter.com/home");
    do_check_eq(account.username, "snowl_test");
    // TODO: separate retrieval from storage of this value.
    //do_check_eq(account.lastRefreshed.getTime(), refreshTime.getTime());
    do_check_eq(account.importance, null);
    do_check_eq(account.placeID.constructor.name, "Number");

    let collection = new SnowlCollection();
    let messages = collection.messages;
    do_check_eq(messages.length, 1);
    let message = messages[0];
    do_check_eq(message.id.constructor.name, "Number");
    do_check_eq(message.sourceID, account.id);
    do_check_eq(message.subject, null);
    do_check_eq(message.authorName, "nofx_test");
    // TODO: do_check_eq(message.authorID, authorID);
    // TODO: test that the message's author is a real identity record
    // with a real person record behind it and the values of those records
    // are all correct.
    do_check_eq(message.link, null);
    do_check_eq(message.timestamp.getTime(), 1242332345000);
    do_check_eq(message.read, false);
    do_check_eq(message.authorIcon, "http://www.nofxofficialwebsite.com/images/index/index_02.gif");
    do_check_eq(message.received.constructor.name, "Date");

    do_check_true(message.content instanceof Ci.nsIFeedTextConstruct);
    do_check_eq(message.content.text, "Or maybe, tear it apart, Start with assumption, That a million people are smart, Smarter than one!");
    do_check_eq(message.content.type, "text");
    do_check_eq(message.content.base, null);
    do_check_eq(message.content.lang, null);

    do_check_eq(message.summary, null);
  }
  finally {
    server.stop();
    do_test_finished();
  }
}
