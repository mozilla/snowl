let SnowlView = {
  _getMessages: function(aMatchWords) {
    let conditions = [];

    if (aMatchWords)
      conditions.push("messages.id IN (SELECT messageID FROM parts WHERE content MATCH :matchWords)");

    let statementString = 
      "SELECT sources.title AS sourceTitle, subject, author, link, timestamp, content \
       FROM sources JOIN messages ON sources.id = messages.sourceID \
       JOIN parts on messages.id = parts.messageID";

    if (conditions.length > 0)
      statementString += " WHERE " + conditions.join(" AND ");

    statementString += " ORDER BY timestamp DESC";

    let statement = SnowlDatastore.createStatement(statementString);

    if (aMatchWords)
      statement.params.matchWords = aMatchWords;

    let messages = [];
    try {
      while (statement.step()) {
        let row = statement.row;
        messages.push({ sourceTitle: row.sourceTitle,
                        subject: row.subject,
                        author: row.author,
                        link: row.link,
                        timestamp: new Date(row.timestamp).toLocaleString(),
                        content: row.content });
      }
    }
    catch(ex) {
      dump(statementString + ": " + ex + ": " + SnowlDatastore.dbConnection.lastErrorString + "\n");
      throw ex;
    }
    finally {
      statement.reset();
    }

    return messages;
  },

  onLoad: function() {
    this._rebuildView();
  },
  
  onUpdate: function() {
    this._rebuildView();
  },

  onFilter: function() {
    let filterTextbox = document.getElementById("filterTextbox");
    this._rebuildView(filterTextbox.value);
  },

  _rebuildView: function(aMatchWords) {
    let rootNode = document.getElementById("snowlView");

    // Empty the view.
    let oldItems = rootNode.getElementsByTagName("listitem");
    for (let i = 0; i < oldItems.length; i++)
      oldItems[i].parentNode.removeChild(oldItems[i]);

    // Get the list of messages.
    let messages = this._getMessages(aMatchWords);

    for each (let message in messages) {
      let item = document.createElement("listitem");
      item.setAttribute("flex", "1");

      let authorCell = document.createElement("listcell");
      authorCell.setAttribute("label", message.author);
      authorCell.setAttribute("crop", "center");

      let subjectCell = document.createElement("listcell");
      subjectCell.setAttribute("label", message.subject);
      subjectCell.setAttribute("crop", "center");
      
      let timestampCell = document.createElement("listcell");
      timestampCell.setAttribute("label", message.timestamp);
      timestampCell.setAttribute("crop", "center");

      item.appendChild(authorCell);
      item.appendChild(subjectCell);
      item.appendChild(timestampCell);
      rootNode.appendChild(item);
    }
  },

  switchPosition: function() {
    let container = document.getElementById("snowlViewContainer");
    let splitter = document.getElementById("snowlViewSplitter");
    let browser = document.getElementById("browser");
    let content = document.getElementById("content");
    let appcontent = document.getElementById("appcontent");

    if (container.parentNode == appcontent) {
      browser.insertBefore(container, appcontent);
      browser.insertBefore(splitter, appcontent);
      splitter.setAttribute("orient", "horizontal");
    }
    else {
      appcontent.insertBefore(container, content);
      appcontent.insertBefore(splitter, content);
      splitter.setAttribute("orient", "vertical");
    }
  }

};
