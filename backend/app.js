const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const aws = require('aws-sdk');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const port = process.env.PORT || 8000;
const app = express();
app.use(cors());
app.use(bodyParser.json());

aws.config.update({
  region: "us-east-1"
});

const s3 = new aws.S3();
const sns = new aws.SNS();
const secretsManager = new aws.SecretsManager();
const bucket = 'emailnestbucket';

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

async function initializeApp() {
  try {
    const credentials = JSON.parse(await getSecretValue('MongoDBSecret'));
    
    mongoose.connect(`mongodb+srv://${credentials.mongo_username}:${credentials.mongo_password}@csci5709.sll5a9t.mongodb.net/?retryWrites=true&w=majority&appName=CSCI5709`, {
      useNewUrlParser: true,
    });

    const db = mongoose.connection;

    db.once('open', () => {
      console.log('Connected to MongoDB');
    });

    const EmailNest = new mongoose.Schema({
      title: String,
      subtitle: String,
      url: String,
      imageKey: String,
      snsTopic: String,
      emails: [String]
    });

    const userSchema = new mongoose.Schema({
      email: { type: String, unique: true },
      password: String
    });

    const User = mongoose.model('User', userSchema);
    const EmailNestLinks = mongoose.model('EmailNest', EmailNest);

    const createSNSTopic = async (topicName) => {
      try {
        const params = {
          Name: topicName,
        };
        const data = await sns.createTopic(params).promise();
        return data.TopicArn;
      } catch (error) {
        throw error;
      }
    };

    app.post('/', async (req, res) => {
      try {
        const body = req.body;
        const imageBuffer = Buffer.from(body.image, 'base64');
        const imageKey = `images/${uuidv4()}.jpg`;
        const params = {
          Bucket: bucket,
          Key: imageKey,
          Body: imageBuffer
        };
        await s3.upload(params).promise();
        const topicName = `link-${uuidv4()}`;
        const snsTopic = await createSNSTopic(topicName);
    
        const linkData = new EmailNestLinks({
          title: body.title,
          url: body.url,
          subtitle: body.subtitle,
          imageKey,
          snsTopic,
          emails: []
        });
        
        await linkData.save();
        res.status(200).json({ message: 'Link created successfully' });
      } catch (err) {
        res.status(500).json({ message: err});
      }
    });

    app.get('/', async (req, res) => {
      try {
        const linkLists = await EmailNestLinks.find({}, { title: 1 });
        const idsWithTitles = linkLists.map(({ _id, title }) => ({ _id, title }));
        res.status(200).json(idsWithTitles);
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
      }
    });

    app.get('/:id', async (req, res) => {
      try { 
        const { id } = req.params; 
        const linkData = await EmailNestLinks.findById(id);
        if (!linkData) {
          return res.status(404).json({ message: 'Form data not found' });
        }
        let data = linkData.toJSON();
        const imageKey = data.imageKey;
        const s3Params = {
          Bucket: bucket,
          Key: imageKey
        };
        const imageObject = await s3.getObject(s3Params).promise();
        const image = imageObject.Body.toString('base64');
        data.imageKey = image;
        res.status(200).json(data);
      } catch (error) {
        res.status(500).json({ message: error });
      }
    });

    app.post('/:id/publish', async (req, res) => {
      try {
        const { id } = req.params;
        const { message } = req.body;
        const linkData = await EmailNestLinks.findById(id);
        if (!linkData) {
          return res.status(404).json({ message: 'Form data not found' });
        }
        const SNSTopicArn = linkData.snsTopic;
        if (!SNSTopicArn) {
          return res.status(400).json({ message: 'SNS topic not found for this link' });
        }
        await publishEmailMessage(SNSTopicArn, message);
        res.status(200).json({ message: 'Message published successfully' });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error', error });
      }
    });

    const publishEmailMessage = async (SNSTopicArn, message) => {
      try {
        const publishParams = {
          Message: message,
          Subject: 'Thank you.',
          TopicArn: SNSTopicArn,
        };
        const publishResult = await sns.publish(publishParams).promise();
      } catch (error) {
        throw error;
      }
    };

    app.post('/signup', async (req, res) => {
      try {
        const { email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ email, password: hashedPassword });
        await user.save();
        res.status(200).json({ message: 'User signed up successfully' });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error', error });
      }
    });

    app.post('/login', async (req, res) => {
      try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) {
          return res.status(404).json({ message: 'User not found' });
        }
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
          return res.status(401).json({ message: 'Incorrect password' });
        }
        res.status(200).json({ message: 'Login successful' });
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error', error });
      }
    });

    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  } catch (error) {
    console.error('Error initializing app:', error);
  }
}

initializeApp();