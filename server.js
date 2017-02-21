// TODO: The user only needs to login to google ONCE, then we can save
//       their UID and just use the service account to access the database.
// TODO: After Google login, check how many other hives the user has in the
//       database and number this hive accordingly.
// TODO: When transfering data from Mongo to Firebase, continuously check
//       older Mongo records until finding one that matches the lattest 
//       Firebase record. Then, all of the Mongo records since the match
//       should be uploaded.
// TODO: Finally, the web client can be much improved.
var express = require('express');
var firebase = require('firebase');
var admin = require('firebase-admin');
var bodyParser = require('body-parser');
var MongoClient = require('mongodb').MongoClient
var assert = require('assert');
var fs = require('fs');

var serviceAccount = require("./sh.json"); // Downloaded from firebase console

var app;
var uid;


/**
 * Check internet connection.
 * @return {Boolean} true if connected, false otherwise.
 */
function isOnline() {
  require('dns').resolve('www.google.com', (err) => {
    if (err) {
      console.log("Failed to connect.");
      return true;
    } else {
      console.log("Connection acquired.");
      return false;
    }
  })
}


/**
 * Checks if a Google UID has already been acquired for this device.
 * @return {Boolean} True if UID already acquired, false otherwise.
 */
function hasUID() {
  var ret = true;
  connectToMongo((db) => {
    db.collection('uid').find().toArray((err, docs) => {
      assert.equal(null, err);

      if (docs.length == 0) {
        ret = false;
        console.log("No uid.");
      } else {
        uid = docs[0]['uid'];
        console.log("uid =", uid);
      }
    });
    db.close();
  });
  return ret;
}


/**
 * Request that user login and authenticate with google.
 * TODO: Serve the actual full web app. Currently this just serves and handles
 *       the Google log in page.
 */
function startServer() {
  app = express();
  app.use(express.static('public'));
  app.use(bodyParser.urlencoded({extended: false}));
  app.use(bodyParser.json());

  // Serve index page of web client for authentication.
  app.get('/', function (req, res) {
    res.sendFile( __dirname + "/index.html" );
  });

  if (!hasUID()) {
    // accept UID from web client, via POST, after Google authentication.
    app.post('/token', function(req, res){
      uid = req.body.uid;
    });
  }

  var server = app.listen(3000, function () {
    var host = server.address().address
    var port = server.address().port
    
    console.log("SmartHive login server listening on port", port)
  });
}


/**
 * Connects to local MongoDB instance, then executes the given callback with
 * a connected instance of the database.
 * @param {Function} callback The function to execute once the db instance has
 * been acquired. It must accept the connected db param.
 */
function connectToMongo(callback) {
  var url = 'mongodb://localhost:27017/sensorData';

  MongoClient.connect(url, (err, db) => { // on success, db is connected object
    assert.equal(null, err); // If err != null, assert fails, function quits.
    console.log("Connected to MongoDB");

    callback(db);
  });
}


/**
 * Read data from the MongoDB instance. Actually, because of Node's async, this
 * function has to both fetch the data from the MongoDB instance, then, in a
 * callback, call writeToFirebase() to send Firebase the data.
 * @param {MongoDB} db Connected database instance.
 */
function getLocalSensorData(db) {
  var data = db.collection('data');

  data.find().sort({"date": -1}).limit(3).toArray((err, docs) => {
    assert.equal(null, err);

    for (var i = 0; i < docs.length; i++) {
      delete docs[i]['_id']; // strip Mongo's index from the data.
    }
    console.log(docs);

    // Check if latest entry in Mongo matches latest entry in Firebase
    var firebase = connectToFirebase();
    var ref = firebase.ref('users/' + uid + '/' + hiveNumber + '/data');
  });

  /*
  data.find({}).toArray((err, docs) => { // transform Cursor into array
    assert.equal(null, err); // check for errors, always, as is the Node way


    console.log(docs);
    //writeToFirebase(docs); // This HAS to happen here, in the callback.
    db.close();
  }); 
  */
 db.close();
}


function connectToFirebase() {
  // Connect to Firebase using service account, emulating user of UID.
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://smarthive-229a5.firebaseio.com",
    databaseAuthVariableOverride: {
      uid: uid
    }
  });
  console.log("Authenticated on firebase as UID=" + uid);

  return admin.database();
}

/**
 * Write data to remote Firebase instance.
 * @param {JSON} data The data to write.
 * @param {Firebase} db Connected Firebase instance (e.g. returned from
 *                      connectToFirebase().
 */
function writeToFirebase(data, db) {
  var ref = db.ref('users/' + uid); // This is the wrong spot to upload this to
  ref.push(data);
}

//connectToMongo(getLocalSensorData);
hasUID();
