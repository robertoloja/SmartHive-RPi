var MongoClient = require('mongodb').MongoClient
var url = 'mongodb://localhost:27017/sensorData'; // MongoDB URL
var express     =   require("express");
var app         =   express();
var bodyParser  =   require("body-parser");
var router      =   express.Router();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({"extended" : false}));


app.use('/',router);

app.listen(3000);
console.log("Listening to PORT 3000");

MongoClient.connect(url, (err, mongoDB) => {
  app.get("/data",function(req,res){
      mongoDB.collection('data')
             .find().toArray((err, docs) => {
        res.json(docs);
  });
});
});
