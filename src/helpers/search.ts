import { buildSchema, GraphQLSchema, GraphQLObjectType, GraphQLInterfaceType, GraphQLUnionType, GraphQLEnumType, GraphQLInputObjectType, GraphQLScalarType, GraphQLNonNull, GraphQLList } from "graphql";
import type { GraphQLType } from "graphql";

function printGraphQLType(type: GraphQLType): string {
	if (type instanceof GraphQLNonNull) {
		return `${printGraphQLType(type.ofType)}!`;
	}
	if (type instanceof GraphQLList) {
		return `[${printGraphQLType(type.ofType)}]`;
	}
	return type.name;
}

export interface SearchableElement {
	elementType: 'type' | 'field' | 'argument' | 'directive';
	name: string;
	parentType?: string;
	description?: string;
	path: string;
	// Additional details
	typeKind?: string; // For types: 'OBJECT', 'INTERFACE', etc.
	returnType?: string; // For fields
	args?: Array<{name: string; type: string; description?: string}>; // For fields and directives
}

export function collectSearchableElements(schema: GraphQLSchema): SearchableElement[] {
	const elements: SearchableElement[] = [];

	// Collect types
	const typeMap = schema.getTypeMap();
	for (const [typeName, type] of Object.entries(typeMap)) {
		if (typeName.startsWith('__')) continue; // Skip introspection types

		let typeKind: string;
		if (type instanceof GraphQLObjectType) typeKind = 'OBJECT';
		else if (type instanceof GraphQLInterfaceType) typeKind = 'INTERFACE';
		else if (type instanceof GraphQLUnionType) typeKind = 'UNION';
		else if (type instanceof GraphQLEnumType) typeKind = 'ENUM';
		else if (type instanceof GraphQLInputObjectType) typeKind = 'INPUT_OBJECT';
		else if (type instanceof GraphQLScalarType) typeKind = 'SCALAR';
		else typeKind = 'UNKNOWN';

		elements.push({
			elementType: 'type',
			name: typeName,
			description: type.description || undefined,
			path: typeName,
			typeKind,
		});

		// Collect fields for object/interface types
		if (type instanceof GraphQLObjectType || type instanceof GraphQLInterfaceType) {
			const fields = type.getFields();
			for (const [fieldName, field] of Object.entries(fields)) {
				const fieldArgs = field.args.map(arg => ({
					name: arg.name,
					type: printGraphQLType(arg.type),
					description: arg.description || undefined,
				}));

				elements.push({
					elementType: 'field',
					name: fieldName,
					parentType: typeName,
					description: field.description || undefined,
					path: `${typeName}.${fieldName}`,
					returnType: printGraphQLType(field.type),
					args: fieldArgs,
				});

				// Collect arguments
				for (const arg of field.args) {
					elements.push({
						elementType: 'argument',
						name: arg.name,
						parentType: `${typeName}.${fieldName}`,
						description: arg.description || undefined,
						path: `${typeName}.${fieldName}(${arg.name})`,
					});
				}
			}
		}

		// Collect input fields for input object types
		if (type instanceof GraphQLInputObjectType) {
			const fields = type.getFields();
			for (const [fieldName, field] of Object.entries(fields)) {
				elements.push({
					elementType: 'field',
					name: fieldName,
					parentType: typeName,
					description: field.description || undefined,
					path: `${typeName}.${fieldName}`,
				});
			}
		}
	}

	// Collect directives
	const directives = schema.getDirectives();
	for (const directive of directives) {
		elements.push({
			elementType: 'directive',
			name: directive.name,
			description: directive.description || undefined,
			path: `@${directive.name}`,
		});

		// Collect directive arguments
		for (const arg of directive.args) {
			elements.push({
				elementType: 'argument',
				name: arg.name,
				parentType: `@${directive.name}`,
				description: arg.description || undefined,
				path: `@${directive.name}(${arg.name})`,
			});
		}
	}

	return elements;
}

export function searchSchemaElements(elements: SearchableElement[], query: string): SearchableElement[] {
	const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 0);
	if (keywords.length === 0) return [];

	return elements.filter(element => {
		const searchableText = `${element.name} ${element.description || ''}`.toLowerCase();
		return keywords.every(keyword => searchableText.includes(keyword));
	});
}

export function getElementDetails(path: string, schema: GraphQLSchema): any {
	const parts = path.split('.');
	if (parts.length === 1) {
		// Type or directive
		const name = parts[0];
		if (name.startsWith('@')) {
			// Directive
			const directiveName = name.slice(1);
			const directive = schema.getDirective(directiveName);
			if (!directive) return null;
			return {
				elementType: 'directive',
				name: directive.name,
				description: directive.description,
				args: directive.args.map(arg => ({
					name: arg.name,
					type: printGraphQLType(arg.type),
					description: arg.description,
				})),
			};
		} else {
			// Type
			const type = schema.getType(name);
			if (!type) return null;
			let details: any = {
				elementType: 'type',
				name: type.name,
				description: type.description,
			};
			if (type instanceof GraphQLObjectType || type instanceof GraphQLInterfaceType) {
				details.kind = type instanceof GraphQLObjectType ? 'OBJECT' : 'INTERFACE';
				details.fields = type.getFields();
				details.fields = Object.values(type.getFields()).map((field: any) => ({
					name: field.name,
					type: printGraphQLType(field.type),
					description: field.description,
					args: field.args.map((arg: any) => ({
						name: arg.name,
						type: printGraphQLType(arg.type),
						description: arg.description,
					})),
				}));
			} else if (type instanceof GraphQLUnionType) {
				details.kind = 'UNION';
				details.possibleTypes = type.getTypes().map(t => t.name);
			} else if (type instanceof GraphQLEnumType) {
				details.kind = 'ENUM';
				details.values = type.getValues().map(v => ({ name: v.name, description: v.description }));
			} else if (type instanceof GraphQLInputObjectType) {
				details.kind = 'INPUT_OBJECT';
				details.fields = Object.values(type.getFields()).map(field => ({
					name: field.name,
					type: printGraphQLType(field.type),
					description: field.description,
				}));
			} else if (type instanceof GraphQLScalarType) {
				details.kind = 'SCALAR';
			}
			return details;
		}
	} else if (parts.length === 2) {
		// Field
		const [typeName, fieldName] = parts;
		const type = schema.getType(typeName);
		if (!type || !(type instanceof GraphQLObjectType || type instanceof GraphQLInterfaceType)) return null;
		const field = type.getFields()[fieldName];
		if (!field) return null;
		return {
			elementType: 'field',
			name: field.name,
			parentType: typeName,
			type: printGraphQLType(field.type),
			description: field.description,
			args: field.args.map(arg => ({
				name: arg.name,
				type: printGraphQLType(arg.type),
				description: arg.description,
			})),
		};
	}
	return null;
}

export async function getSchemaForSearch(endpoint: string, headers?: Record<string, string>, schemaPath?: string): Promise<GraphQLSchema> {
	let schemaSDL: string;
	if (schemaPath) {
		if (schemaPath.startsWith('http://') || schemaPath.startsWith('https://')) {
			const response = await fetch(schemaPath);
			if (!response.ok) throw new Error(`Failed to fetch schema: ${response.statusText}`);
			schemaSDL = await response.text();
		} else {
			const { readFile } = await import('node:fs/promises');
			schemaSDL = await readFile(schemaPath, 'utf8');
		}
	} else {
		const { getIntrospectionQuery, buildClientSchema } = await import('graphql');
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...headers,
			},
			body: JSON.stringify({
				query: getIntrospectionQuery(),
			}),
		});
		if (!response.ok) throw new Error(`Introspection failed: ${response.statusText}`);
		const data = await response.json();
		const schema = buildClientSchema(data.data);
		return schema;
	}

	return buildSchema(schemaSDL);
}