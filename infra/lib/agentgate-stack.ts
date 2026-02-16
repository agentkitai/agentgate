import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/** Environment-specific config */
interface EnvConfig {
  cpu: number;
  memoryLimitMiB: number;
  desiredCount: number;
  rdsInstanceType: ec2.InstanceType;
  rdsMultiAz: boolean;
  redisNodeType: string;
  redisNumNodes: number;
  architecture: ecs.CpuArchitecture;
}

const ENV_CONFIGS: Record<string, EnvConfig> = {
  staging: {
    cpu: 512,
    memoryLimitMiB: 1024,
    desiredCount: 1,
    rdsInstanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
    rdsMultiAz: false,
    redisNodeType: 'cache.t4g.micro',
    redisNumNodes: 1,
    architecture: ecs.CpuArchitecture.ARM64,
  },
  production: {
    cpu: 1024,
    memoryLimitMiB: 2048,
    desiredCount: 2,
    rdsInstanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.SMALL),
    rdsMultiAz: true,
    redisNodeType: 'cache.t4g.small',
    redisNumNodes: 2,
    architecture: ecs.CpuArchitecture.ARM64,
  },
};

export interface AgentGateStackProps extends cdk.StackProps {
  environment: string;
}

export class AgentGateStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AgentGateStackProps) {
    super(scope, id, props);

    const envName = props.environment;
    const config = ENV_CONFIGS[envName] ?? ENV_CONFIGS.staging;

    // Override architecture from context if provided
    const archContext = this.node.tryGetContext('architecture');
    const cpuArch = archContext === 'x86_64'
      ? ecs.CpuArchitecture.X86_64
      : config.architecture;

    // ── VPC ──────────────────────────────────────────────────
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: envName === 'production' ? 2 : 1,
    });

    // ── Security Groups ─────────────────────────────────────
    const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc,
      description: 'ALB security group',
      allowAllOutbound: true,
    });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP');
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS');

    const ecsSg = new ec2.SecurityGroup(this, 'EcsSg', {
      vpc,
      description: 'ECS tasks security group',
    });
    ecsSg.addIngressRule(albSg, ec2.Port.tcp(3002), 'From ALB');

    const rdsSg = new ec2.SecurityGroup(this, 'RdsSg', {
      vpc,
      description: 'RDS security group',
    });
    rdsSg.addIngressRule(ecsSg, ec2.Port.tcp(5432), 'From ECS');

    const redisSg = new ec2.SecurityGroup(this, 'RedisSg', {
      vpc,
      description: 'ElastiCache Redis security group',
    });
    redisSg.addIngressRule(ecsSg, ec2.Port.tcp(6379), 'From ECS');

    // ── Secrets Manager ─────────────────────────────────────
    const adminApiKey = new secretsmanager.Secret(this, 'AdminApiKey', {
      secretName: `agentgate/${envName}/ADMIN_API_KEY`,
      generateSecretString: { excludePunctuation: true, passwordLength: 32 },
    });

    const jwtSecret = new secretsmanager.Secret(this, 'JwtSecret', {
      secretName: `agentgate/${envName}/JWT_SECRET`,
      generateSecretString: { excludePunctuation: true, passwordLength: 64 },
    });

    const oidcClientSecret = new secretsmanager.Secret(this, 'OidcClientSecret', {
      secretName: `agentgate/${envName}/OIDC_CLIENT_SECRET`,
      description: 'OIDC client secret — update value after deployment',
    });

    // ── RDS Postgres ────────────────────────────────────────
    const dbCredentials = rds.Credentials.fromGeneratedSecret('agentgate', {
      secretName: `agentgate/${envName}/db-credentials`,
    });

    const database = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_4,
      }),
      instanceType: config.rdsInstanceType,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [rdsSg],
      credentials: dbCredentials,
      databaseName: 'agentgate',
      multiAz: config.rdsMultiAz,
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageEncrypted: true,
      removalPolicy: envName === 'production'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      deletionProtection: envName === 'production',
    });

    // Build DATABASE_URL secret from RDS credentials
    const databaseUrlSecret = new secretsmanager.Secret(this, 'DatabaseUrl', {
      secretName: `agentgate/${envName}/DATABASE_URL`,
      description: 'Constructed DATABASE_URL — updated by post-deploy script or Lambda',
    });

    // ── ElastiCache Redis ───────────────────────────────────
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: `AgentGate ${envName} Redis subnet group`,
      subnetIds: vpc.privateSubnets.map(s => s.subnetId),
    });

    const redis = new elasticache.CfnReplicationGroup(this, 'Redis', {
      replicationGroupDescription: `AgentGate ${envName} Redis`,
      engine: 'redis',
      cacheNodeType: config.redisNodeType,
      numCacheClusters: config.redisNumNodes,
      automaticFailoverEnabled: config.redisNumNodes > 1,
      cacheSubnetGroupName: redisSubnetGroup.ref,
      securityGroupIds: [redisSg.securityGroupId],
      atRestEncryptionEnabled: true,
      transitEncryptionEnabled: true,
    });

    // ── ECS Cluster ─────────────────────────────────────────
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      containerInsights: envName === 'production',
    });

    // ── IAM Roles ───────────────────────────────────────────
    const executionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy',
        ),
      ],
    });

    // Grant read access to all secrets
    for (const secret of [adminApiKey, jwtSecret, oidcClientSecret, databaseUrlSecret]) {
      secret.grantRead(executionRole);
    }
    if (database.secret) {
      database.secret.grantRead(executionRole);
    }

    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // ── Task Definition ─────────────────────────────────────
    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: config.cpu,
      memoryLimitMiB: config.memoryLimitMiB,
      executionRole,
      taskRole,
      runtimePlatform: {
        cpuArchitecture: cpuArch,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: `/ecs/agentgate-${envName}`,
      retention: envName === 'production'
        ? logs.RetentionDays.ONE_MONTH
        : logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const container = taskDef.addContainer('agentgate', {
      image: ecs.ContainerImage.fromAsset('..', {
        file: 'Dockerfile',
        platform:
          cpuArch === ecs.CpuArchitecture.ARM64
            ? cdk.aws_ecr_assets.Platform.LINUX_ARM64
            : cdk.aws_ecr_assets.Platform.LINUX_AMD64,
        exclude: ['node_modules', '.git', 'infra/cdk.out', 'infra/node_modules', '*.md', '_bmad', '_bmad-output', '.auto-claude', '.claude', 'docs', 'specs', 'tasks', 'demo', 'vendor'],
      }),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'agentgate', logGroup }),
      environment: {
        NODE_ENV: envName === 'production' ? 'production' : 'staging',
        PORT: '3002',
        REDIS_URL: `rediss://${redis.attrPrimaryEndPointAddress}:${redis.attrPrimaryEndPointPort}`,
      },
      secrets: {
        ADMIN_API_KEY: ecs.Secret.fromSecretsManager(adminApiKey),
        JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret),
        OIDC_CLIENT_SECRET: ecs.Secret.fromSecretsManager(oidcClientSecret),
        DATABASE_URL: ecs.Secret.fromSecretsManager(databaseUrlSecret),
      },
      portMappings: [{ containerPort: 3002 }],
      healthCheck: {
        command: ['CMD-SHELL', 'wget -qO- http://localhost:3002/ready || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    // ── ALB ─────────────────────────────────────────────────
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      securityGroup: albSg,
    });

    const listener = alb.addListener('HttpListener', {
      port: 80,
    });

    // ── ECS Fargate Service ─────────────────────────────────
    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: config.desiredCount,
      securityGroups: [ecsSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      healthCheckGracePeriod: cdk.Duration.seconds(120),
    });

    listener.addTargets('EcsTarget', {
      port: 3002,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        healthyHttpCodes: '200',
      },
    });

    // ── Outputs ─────────────────────────────────────────────
    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: alb.loadBalancerDnsName,
      description: 'ALB DNS name',
    });

    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: database.dbInstanceEndpointAddress,
      description: 'RDS endpoint',
    });

    new cdk.CfnOutput(this, 'RedisEndpoint', {
      value: redis.attrPrimaryEndPointAddress,
      description: 'Redis primary endpoint',
    });
  }
}
