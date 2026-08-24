# ECS Service Auto Scaling for the API. Free while idle — you only pay for extra
# tasks when CPU actually needs them. min 1 keeps the service always-on; the ECS
# rolling-deploy defaults (start-before-stop) + the ALB draining make both deploys
# and scale events zero-downtime. desired_count is ignored by the service (see
# ecs.tf lifecycle) so Terraform and autoscaling don't fight.

resource "aws_appautoscaling_target" "api" {
  min_capacity       = 1
  max_capacity       = 6
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "api_cpu" {
  name               = "tovira-${var.env}-api-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.api.service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 60
    scale_out_cooldown = 60
    scale_in_cooldown  = 300
  }
}
