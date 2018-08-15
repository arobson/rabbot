FROM rabbitmq:3-management

COPY docker_files/rabbitmq.config /etc/rabbitmq/

COPY docker_files/custom_definitions.json /etc/rabbitmq/

RUN rabbitmq-plugins enable --offline rabbitmq_consistent_hash_exchange
