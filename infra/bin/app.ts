#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AgentGateStack } from '../lib/agentgate-stack';

const app = new cdk.App();
const env = app.node.tryGetContext('env') || 'staging';

new AgentGateStack(app, `AgentGate-${env}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  environment: env,
});
