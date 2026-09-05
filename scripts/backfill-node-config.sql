UPDATE nodes SET sensor_capabilities = '["soilMoisture","nitrogen","phosphorus","potassium","soilTemp","airTemp","airHumidity"]'::jsonb,
  installed_at = NOW() - INTERVAL '5 months', max_runtime_minutes = 120, flow_rate_l_per_min = 16.0
WHERE id = 'SN-RG-01';
UPDATE nodes SET sensor_capabilities = '["soilMoisture","nitrogen","phosphorus","potassium","soilTemp","airTemp","airHumidity"]'::jsonb,
  installed_at = NOW() - INTERVAL '5 months' WHERE id IN ('SN-RG-02','SN-RG-03');
UPDATE nodes SET sensor_capabilities = '["soilMoisture","nitrogen","phosphorus","potassium","soilTemp","airTemp","airHumidity"]'::jsonb,
  installed_at = NOW() - INTERVAL '3 months', max_runtime_minutes = 90, flow_rate_l_per_min = 14.0
WHERE id = 'SN-RG-04';
UPDATE nodes SET sensor_capabilities = '["soilMoisture","soilTemp"]'::jsonb,
  installed_at = NOW() - INTERVAL '3 months' WHERE id = 'SN-RG-05';
UPDATE nodes SET sensor_capabilities = '["soilMoisture","nitrogen","phosphorus","potassium","soilTemp","airTemp","airHumidity"]'::jsonb,
  installed_at = NOW() - INTERVAL '6 months', max_runtime_minutes = 60, flow_rate_l_per_min = 12.0
WHERE id = 'SN-RG-06';
