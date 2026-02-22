import configFn from '../../src/config.js';

describe('Configuration', function () {
  const noOp = () => {};
  const connection = {
    name: 'test',
    configureBindings: noOp as unknown as (bindings: unknown[], name: string) => Promise<boolean>,
    configureExchanges: noOp as unknown as (exchanges: unknown[]) => Promise<boolean>,
    configureQueues: noOp as unknown as (queues: unknown[]) => Promise<boolean>,
    once: noOp
  };

  interface BrokerLike {
    connection: typeof connection;
    configurations: Record<string, unknown>;
    configuring: Record<string, Promise<void>>;
    configure: (config: {
      exchanges: unknown[];
      queues: unknown[];
      bindings: unknown[];
      name?: string;
      connection?: unknown;
    }) => Promise<void>;
    addConnection: () => Promise<typeof connection>;
    emit: (...args: unknown[]) => void;
  }

  const Broker = function (this: BrokerLike, conn: typeof connection) {
    this.connection = conn;
    this.configurations = {};
    this.configuring = {};
  } as unknown as new (conn: typeof connection) => BrokerLike;

  (Broker.prototype as BrokerLike).addConnection = function () {
    return Promise.resolve(this.connection);
  };

  (Broker.prototype as BrokerLike).emit = function () {};

  configFn(Broker);

  describe('with valid configuration', function () {
    const config = {
      exchanges: [{}],
      queues: [{}],
      bindings: [{}]
    };

    beforeAll(function () {
      vi.spyOn(connection, 'configureExchanges').mockReturnValue(Promise.resolve(true) as unknown as ReturnType<typeof connection.configureExchanges>);
      vi.spyOn(connection, 'configureQueues').mockReturnValue(Promise.resolve(true) as unknown as ReturnType<typeof connection.configureQueues>);
      vi.spyOn(connection, 'configureBindings').mockReturnValue(Promise.resolve(true) as unknown as ReturnType<typeof connection.configureBindings>);

      const broker = new Broker(connection);
      return broker.configure(config);
    });

    it('should make expected calls', function () {
      expect(connection.configureExchanges).toHaveBeenCalledOnce();
      expect(connection.configureExchanges).toHaveBeenCalledWith(config.exchanges);
      expect(connection.configureQueues).toHaveBeenCalledOnce();
      expect(connection.configureQueues).toHaveBeenCalledWith(config.queues);
      expect(connection.configureBindings).toHaveBeenCalledOnce();
      expect(connection.configureBindings).toHaveBeenCalledWith(config.bindings, 'test');
    });

    afterAll(function () {
      vi.restoreAllMocks();
    });
  });

  describe('with an initially failed connection', function () {
    const config = {
      exchanges: [{}],
      queues: [{}],
      bindings: [{}]
    };

    beforeAll(function () {
      vi.spyOn(connection, 'configureExchanges').mockReturnValue(Promise.resolve(true) as unknown as ReturnType<typeof connection.configureExchanges>);
      vi.spyOn(connection, 'configureQueues').mockReturnValue(Promise.resolve(true) as unknown as ReturnType<typeof connection.configureQueues>);
      vi.spyOn(connection, 'configureBindings').mockReturnValue(Promise.resolve(true) as unknown as ReturnType<typeof connection.configureBindings>);

      const broker = new Broker(connection);
      return broker.configure(config);
    });

    it('should make expected calls', function () {
      expect(connection.configureExchanges).toHaveBeenCalledOnce();
      expect(connection.configureExchanges).toHaveBeenCalledWith(config.exchanges);
      expect(connection.configureQueues).toHaveBeenCalledOnce();
      expect(connection.configureQueues).toHaveBeenCalledWith(config.queues);
      expect(connection.configureBindings).toHaveBeenCalledOnce();
      expect(connection.configureBindings).toHaveBeenCalledWith(config.bindings, 'test');
    });

    afterAll(function () {
      vi.restoreAllMocks();
    });
  });

  describe('when exchange creation fails', function () {
    const config = {
      exchanges: [{}],
      queues: [{}],
      bindings: [{}]
    };
    let error: Error;

    beforeAll(function () {
      vi.spyOn(connection, 'configureExchanges').mockReturnValue(
        Promise.reject(new Error("Not feelin' it today")) as unknown as ReturnType<typeof connection.configureExchanges>
      );
      vi.spyOn(connection, 'configureQueues');
      vi.spyOn(connection, 'configureBindings');

      const broker = new Broker(connection);
      return broker.configure(config)
        .then(null, function (err: Error) {
          error = err;
        });
    });

    it('should make expected calls', function () {
      expect(connection.configureExchanges).toHaveBeenCalledOnce();
      expect(connection.configureQueues).not.toHaveBeenCalled();
      expect(connection.configureBindings).not.toHaveBeenCalled();
    });

    it('should return error', function () {
      expect(error.toString()).toBe("Error: Not feelin' it today");
    });

    afterAll(function () {
      vi.restoreAllMocks();
    });
  });

  describe('when queue creation fails', function () {
    const config = {
      exchanges: [{}],
      queues: [{}],
      bindings: [{}]
    };
    let error: Error;

    beforeAll(function () {
      vi.spyOn(connection, 'configureExchanges').mockReturnValue(Promise.resolve(true) as unknown as ReturnType<typeof connection.configureExchanges>);
      vi.spyOn(connection, 'configureQueues').mockReturnValue(
        Promise.reject(new Error("Not feelin' it today")) as unknown as ReturnType<typeof connection.configureQueues>
      );
      vi.spyOn(connection, 'configureBindings');

      const broker = new Broker(connection);
      return broker.configure(config)
        .then(null, function (err: Error) {
          error = err;
        });
    });

    it('should make expected calls', function () {
      expect(connection.configureExchanges).toHaveBeenCalledOnce();
      expect(connection.configureQueues).toHaveBeenCalledOnce();
      expect(connection.configureBindings).not.toHaveBeenCalled();
    });

    it('should return error', function () {
      expect(error.toString()).toBe("Error: Not feelin' it today");
    });

    afterAll(function () {
      vi.restoreAllMocks();
    });
  });

  describe('when binding creation fails', function () {
    const config = {
      exchanges: [{}],
      queues: [{}],
      bindings: [{}]
    };
    let error: Error;

    beforeAll(function () {
      vi.spyOn(connection, 'configureExchanges').mockReturnValue(Promise.resolve(true) as unknown as ReturnType<typeof connection.configureExchanges>);
      vi.spyOn(connection, 'configureQueues').mockReturnValue(Promise.resolve(true) as unknown as ReturnType<typeof connection.configureQueues>);
      vi.spyOn(connection, 'configureBindings').mockReturnValue(
        Promise.reject(new Error("Not feelin' it today")) as unknown as ReturnType<typeof connection.configureBindings>
      );

      const broker = new Broker(connection);
      return broker.configure(config)
        .then(null, function (err: Error) {
          error = err;
        });
    });

    it('should make expected calls', function () {
      expect(connection.configureExchanges).toHaveBeenCalledOnce();
      expect(connection.configureQueues).toHaveBeenCalledOnce();
      expect(connection.configureBindings).toHaveBeenCalledOnce();
    });

    it('should return error', function () {
      expect(error.toString()).toBe("Error: Not feelin' it today");
    });

    afterAll(function () {
      vi.restoreAllMocks();
    });
  });
});
