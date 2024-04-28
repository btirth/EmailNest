const mongoose = require('mongoose');
const aws = require('aws-sdk');

const s3 = new aws.S3();
const secretsManager = new aws.SecretsManager();
const bucket = 'emailnestbucket';

const EmailNest = new mongoose.Schema({
  title: String,
  subtitle: String,
  url: String,
  imageKey: String,
  emails: [String]
});

const EmailNestLinks = mongoose.model('EmailNest', EmailNest);

async function getSecretValue(secretName) {
  try {
      const data = await secretsManager.getSecretValue({ SecretId: secretName }).promise();
      if ('SecretString' in data) {
          return data.SecretString;
      } else {
          const buff = Buffer.from(data.SecretBinary, 'base64');
          return buff.toString('ascii');
      }
  } catch (error) {
      throw error;
  }
}

exports.handler = async (event) => {
  try {
    const id = event.queryStringParameters.id;
    const credentials = JSON.parse(await getSecretValue('MongoDBSecret'));
    
    mongoose.connect(`mongodb+srv://${credentials.mongo_username}:${credentials.mongo_password}@csci5709.sll5a9t.mongodb.net/?retryWrites=true&w=majority&appName=CSCI5709`, {
      useNewUrlParser: true,
    });
  
    const db = mongoose.connection;

    db.once('open', () => {
      console.log('Connected to MongoDB');
    });
    
    const imageData = await EmailNestLinks.findById(id);

    const s3Params = {
      Bucket: bucket,
      Key: imageData.imageKey
    };

    const imageObject = await s3.getObject(s3Params).promise();
    const image = imageObject.Body.toString('base64');

    return {
      statusCode: 200,
      body: JSON.stringify({
        title: imageData.title,
        url: imageData.url,
        image: image,
        subtitle: imageData.subtitle
      })
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Internal server error' })
    };
  }
};
