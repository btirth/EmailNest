const aws = require('aws-sdk');
const mongoose = require('mongoose');
const sns = new aws.SNS();
const secretsManager = new aws.SecretsManager();

const EmailNest = new mongoose.Schema({
  title: String,
  subtitle: String,
  url: String,
  imageKey: String,
  snsTopic: String,
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

const subscribeEmail = async (email, SNSTopicArn) => {
  try {
    const subscribeParams = {
      Protocol: 'email',
      TopicArn: SNSTopicArn,
      Endpoint: email,
    };
    const subscribeResult = await sns.subscribe(subscribeParams).promise();
    return subscribeResult.SubscriptionArn;
  } catch (error) {
    throw error;
  }
};

exports.handler = async (event) => {
  try {
    const id = event.pathParameters.id;
    const email = event.queryStringParameters.email;

    const credentials = JSON.parse(await getSecretValue('MongoDBSecret'));
    
    mongoose.connect(`mongodb+srv://${credentials.mongo_username}:${credentials.mongo_password}@csci5709.sll5a9t.mongodb.net/?retryWrites=true&w=majority&appName=CSCI5709`, {
      useNewUrlParser: true,
    });

    const db = mongoose.connection;

    db.once('open', () => {
      console.log('Connected to MongoDB');
    });
  
    let emailList = await EmailNestLinks.findById(id);

    if (!emailList) {
      return {
        statusCode: 404,
        body: JSON.stringify({ message: 'Email list not found' })
      };
    }

    emailList.emails.push(email);
    await emailList.save();

    const SNSTopicArn = emailList.snsTopic;
    const subscriptionArn = await subscribeEmail(email, SNSTopicArn);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Email added to the list successfully' })
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Internal server error' })
    };
  }
};